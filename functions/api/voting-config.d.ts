interface PagesFunctionContext {
  request: Request;
  env: Record<string, string | undefined>;
}

export function onRequest(context: PagesFunctionContext): Response;
