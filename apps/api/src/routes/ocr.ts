import Anthropic from '@anthropic-ai/sdk';
import { Hono } from 'hono';
import type { OcrLineItem, OcrRequest, OcrResponse } from '@split-it/types';
import { requireAuth } from '../lib/auth.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const router = new Hono();

router.post('/', async (c) => {
  const userId = await requireAuth(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  let body: OcrRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { imageBase64, mimeType } = body;
  if (!imageBase64 || !mimeType) {
    return c.json({ error: 'imageBase64 and mimeType are required' }, 400);
  }

  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!validTypes.includes(mimeType)) {
    return c.json({ error: 'Unsupported image type' }, 400);
  }

  // The model has no reliable sense of the current date (it defaults to its training era),
  // so give it today's date for resolving missing or two-digit years
  const today = new Date().toISOString().slice(0, 10);

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: `Extract all line items from this receipt. Return ONLY a JSON object with this exact shape — no markdown, no explanation:
{
  "restaurant_name": "string or null",
  "date": "YYYY-MM-DD or null",
  "line_items": [
    {
      "description": "string",
      "quantity": number,
      "unit_price": number,
      "total_price": number,
      "modifiers": [{ "description": "string", "price": number or null }]
    }
  ],
  "subtotal": number or null,
  "tax": number or null,
  "tip": number or null,
  "total": number or null
}

Rules:
- The photo may still be slightly tilted or curled. Follow each printed line along its slant so every price is matched to the item on the same printed line, not the line above or below.
- CRITICAL: Preserve the exact top-to-bottom order items appear printed on the receipt. Do NOT reorder, sort, or group items in any way.
- Receipt line format: a line starting with a quantity number (e.g. "2 Burger") begins a new item. Any following lines that do NOT start with a quantity number (often indented) are add-ons/modifiers for that same item — list each one in that item's "modifiers" array with its printed price. Many add-ons are free: if no price is printed, or it's marked "no charge", "NC", "N/C", "free" or 0.00, use null — never guess a price. Free add-ons still go in "modifiers" so their description is kept (e.g. "no onion"). Use [] when there are none. An unpriced line directly under an item (e.g. "2 Taiyaki Ice cream $15.00" then "Vanilla ice cream") is ALWAYS a modifier of that item, never its own line item.
- The item's unit_price and total_price are the item's OWN printed price only — never add modifier prices into them; that is done later.
- A line item with a printed price of 0.00 (e.g. "1 Water 0.00") is a genuine free item: keep it as its own line item with total_price 0. Use null for total_price and unit_price ONLY when no price is printed at all.
- All monetary values are numbers (e.g. 12.50, not "$12.50")
- quantity defaults to 1 if not shown
- unit_price = total_price / quantity
- Omit tax-only or tip-only lines from line_items — put them in the top-level tax/tip fields
- date: the receipt date in YYYY-MM-DD format; null if not found. Today's date is ${today}. If the year is missing, use the most recent occurrence of that month/day on or before today. A two-digit year YY means 20YY.
- If a value is unclear, use null`,
          },
        ],
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    console.error('[OCR] No text block in response:', JSON.stringify(message.content));
    return c.json({ error: 'No text response from OCR' }, 500);
  }

  console.log('[OCR] Raw response:\n', textBlock.text);

  type RawLineItem = Partial<OcrLineItem> & { modifiers?: { description?: string; price?: number | null }[] };
  let parsed: Omit<OcrResponse, 'line_items'> & { line_items?: RawLineItem[] };
  try {
    const raw = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[OCR] JSON parse failed:', e);
    console.error('[OCR] Text was:', textBlock.text);
    return c.json({ error: `Failed to parse OCR response: ${(e as Error).message}`, raw: textBlock.text }, 500);
  }

  // Backstop for the model listing an add-on as its own line: a line with no printed price at
  // all (null, not 0) belongs to the item above, as a free modifier. A printed $0.00 is a
  // genuine free item and stays separate.
  const rawItems = (parsed.line_items ?? []).reduce<RawLineItem[]>((acc, li) => {
    const prev = acc[acc.length - 1];
    if (prev && li.total_price == null && li.unit_price == null && li.description) {
      prev.modifiers = [...(prev.modifiers ?? []), { description: li.description, price: null }, ...(li.modifiers ?? [])];
    } else {
      acc.push({ ...li });
    }
    return acc;
  }, []);

  // Sanitize numeric fields that Claude may return as null, and fold priced add-ons
  // ("1 Strawberry Mojito $15.00 / strawberry puree $2.00") into their item's price.
  // The sum is done here rather than by the model so the arithmetic is exact.
  const sanitized: OcrResponse = {
    ...parsed,
    line_items: rawItems.map((li) => {
      const quantity = li.quantity ?? 1;
      const baseTotal = li.total_price ?? (li.unit_price ?? 0) * quantity;
      const modifiers = li.modifiers ?? [];
      const totalCents = Math.round(baseTotal * 100)
        // Free add-ons come back as null (or occasionally text like "NC") — count them as 0
        + modifiers.reduce((s, m) => s + (Number.isFinite(Number(m.price)) ? Math.round(Number(m.price) * 100) : 0), 0);
      const total_price = totalCents / 100;
      // "Burger - with cheese, no onion"
      const addOns = modifiers.map((m) => m.description?.trim()).filter(Boolean).join(', ');
      const description = [li.description ?? '', addOns].filter(Boolean).join(' - ');
      return {
        description,
        quantity,
        unit_price: quantity > 0 ? total_price / quantity : total_price,
        total_price,
      };
    }),
  };

  return c.json(sanitized);
});

export default router;
