import Anthropic from '@anthropic-ai/sdk';
import { Hono } from 'hono';
import type { OcrRequest, OcrResponse } from '@split-it/types';
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
    { "description": "string", "quantity": number, "unit_price": number, "total_price": number }
  ],
  "subtotal": number or null,
  "tax": number or null,
  "tip": number or null,
  "total": number or null
}

Rules:
- CRITICAL: Preserve the exact top-to-bottom order items appear printed on the receipt. Do NOT reorder, sort, or group items in any way.
- Receipt line format: a line starting with a quantity number (e.g. "2 Burger") begins a new item. Any following lines that do NOT start with a quantity number are descriptor/modifier lines for that same item — append them to the item's description (e.g. "Burger - with cheese, no onion").
- All monetary values are numbers (e.g. 12.50, not "$12.50")
- quantity defaults to 1 if not shown
- unit_price = total_price / quantity
- Omit tax-only or tip-only lines from line_items — put them in the top-level tax/tip fields
- date: the receipt date in YYYY-MM-DD format; if only month/day visible, assume current year; null if not found
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

  let parsed: OcrResponse;
  try {
    const raw = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(raw) as OcrResponse;
  } catch (e) {
    console.error('[OCR] JSON parse failed:', e);
    console.error('[OCR] Text was:', textBlock.text);
    return c.json({ error: `Failed to parse OCR response: ${(e as Error).message}`, raw: textBlock.text }, 500);
  }

  // Sanitize numeric fields that Claude may return as null
  const sanitized: OcrResponse = {
    ...parsed,
    line_items: (parsed.line_items ?? []).map((li) => ({
      description: li.description ?? '',
      quantity: li.quantity ?? 1,
      unit_price: li.unit_price ?? 0,
      total_price: li.total_price ?? (li.unit_price != null ? (li.unit_price ?? 0) * (li.quantity ?? 1) : 0),
    })),
  };

  return c.json(sanitized);
});

export default router;
