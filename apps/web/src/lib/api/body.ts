import { ApiProblem } from './handler';

/** Reads a JSON body with a hard size limit (SPEC §10 input limits). */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes)
    throw new ApiProblem(413, 'PAYLOAD_TOO_LARGE', `Body exceeds ${maxBytes} bytes`);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new ApiProblem(413, 'PAYLOAD_TOO_LARGE', `Body exceeds ${maxBytes} bytes`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiProblem(400, 'INVALID_REQUEST', 'Body must be JSON');
  }
}
