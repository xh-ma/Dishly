/**
 * Last-resort dish photo. Tries a generated food photograph, then draws a
 * plate card ourselves if that service is unreachable.
 */
import { ImageResponse } from 'next/og';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeDishName } from '@/lib/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

function seedFrom(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1_000_000;
}

function photoFile(key: string): string {
  return join(process.cwd(), '.cache', 'photos', `${key || 'dish'}.bin`);
}

async function generateFoodPhoto(name: string): Promise<{ bytes: Buffer; type: string } | undefined> {
  const prompt = `professional restaurant food photography of ${name}, plated dish, close-up, warm lighting, appetizing, no text, no watermark`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=800&height=600&nologo=true&model=flux&seed=${seedFrom(name)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return undefined;
    return { bytes: Buffer.from(await res.arrayBuffer()), type };
  } catch {
    return undefined;
  }
}

function drawnPlate(name: string) {
  const label = name.length > 42 ? `${name.slice(0, 40)}…` : name;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#eddfc4',
        }}
      >
        <div
          style={{
            width: 340,
            height: 340,
            borderRadius: 999,
            background: '#fdf8ec',
            border: '14px solid #cdb17a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 36,
          }}
        >
          <div
            style={{
              fontSize: 36,
              color: '#2a1b10',
              textAlign: 'center',
              lineHeight: 1.2,
              display: 'flex',
            }}
          >
            {label}
          </div>
        </div>
      </div>
    ),
    { width: 800, height: 600 },
  );
}

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 120) || 'Dish';
  const key = normalizeDishName(name).replace(/\s+/g, '-') || 'dish';
  const file = photoFile(key);

  try {
    const cached = readFileSync(file);
    const type = cached.subarray(0, 8).toString('hex').startsWith('89504e47') ? 'image/png' : 'image/jpeg';
    return new Response(new Uint8Array(cached), {
      headers: { 'content-type': type, 'cache-control': 'public, max-age=86400, immutable' },
    });
  } catch {
    // generate
  }

  const generated = await generateFoodPhoto(name);
  if (generated) {
    try {
      mkdirSync(join(process.cwd(), '.cache', 'photos'), { recursive: true });
      writeFileSync(file, generated.bytes);
    } catch {
      // still return the bytes
    }
    return new Response(new Uint8Array(generated.bytes), {
      headers: { 'content-type': generated.type, 'cache-control': 'public, max-age=86400, immutable' },
    });
  }

  return drawnPlate(name);
}
