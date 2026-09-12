import { createFileRoute } from "@tanstack/react-router";
import { CsrfError, assertCsrfOnRequest } from "@/lib/auth/csrf.server";
import { isEmailPasswordSignIn, runWithPasswordDummyPad } from "@/lib/auth/password.server";
import { auth } from "@/lib/auth/server";

function handleAuth(request: Request): Promise<Response> {
  try {
    assertCsrfOnRequest(request);
  } catch (err) {
    if (err instanceof CsrfError) {
      return Promise.resolve(
        new Response(JSON.stringify({ message: err.message }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    throw err;
  }
  // Better Auth hashes with a fresh salt when the email/credential is missing.
  // Pad that miss through the same scrypt+compare as a real verify.
  if (isEmailPasswordSignIn(request)) {
    return runWithPasswordDummyPad(() => auth.handler(request));
  }
  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuth(request),
      POST: ({ request }) => handleAuth(request),
    },
  },
});