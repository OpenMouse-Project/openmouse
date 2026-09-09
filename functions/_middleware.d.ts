// Minimal bindings for the site-wide guard so TS tests can import it.
export declare function onRequest(context: {
  request: Request;
  env: Record<string, unknown>;
  next: () => Promise<Response> | Response;
}): Promise<Response> | Response;