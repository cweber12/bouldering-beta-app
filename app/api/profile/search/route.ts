import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth } from "@/utils/firebase/admin";
import {
  getAuthUserId,
  readProfileStorage,
  listProfileStorage,
  awsErrorMessage,
} from "../../s3/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IndexEntry {
  displayName?: string;
  email?: string;
  location?: string;
}

const INDEX_FOLDER = "ProfileData/_index";

async function fallbackFirebaseSearch(q: string, authUserId: string) {
  const auth = getAdminAuth();
  const matches: Array<{ userId: string; displayName?: string; email?: string; location?: string }> = [];
  let pageToken: string | undefined;

  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (user.uid === authUserId) continue;

      const uid = user.uid.toLowerCase();
      const name = (user.displayName ?? "").toLowerCase();
      const email = (user.email ?? "").toLowerCase();
      if (!uid.includes(q) && !name.includes(q) && !email.includes(q)) continue;

      matches.push({
        userId: user.uid,
        displayName: user.displayName ?? "",
        email: user.email ?? "",
      });
      if (matches.length >= 20) return matches;
    }
    pageToken = page.pageToken;
  } while (pageToken);

  return matches;
}

// ---------------------------------------------------------------------------
// GET — search users by displayName, userId, or email (query param: q)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authUserId = await getAuthUserId();
  if (!authUserId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) {
    return NextResponse.json(
      { error: "Search query must be at least 2 characters." },
      { status: 400 },
    );
  }
  if (q.length > 200) {
    return NextResponse.json({ error: "Search query too long." }, { status: 400 });
  }

  try {
    // List all index files.
    const fileNames = await listProfileStorage(INDEX_FOLDER);

    // Read index entries in parallel. Search the full index so known accounts
    // are never dropped before matching.
    const entries = await Promise.all(
      fileNames.map(async (fileName) => {
        const entry = await readProfileStorage<IndexEntry>(`${INDEX_FOLDER}/${fileName}`);
        if (!entry) return null;
        const userId = fileName.replace(".json", "");
        return { userId, ...entry };
      }),
    );

    // Filter by search query
    const results = entries
      .filter((e): e is NonNullable<typeof e> => {
        if (!e || e.userId === authUserId) return false;
        const userId = e.userId.toLowerCase();
        const name = (e.displayName ?? "").toLowerCase();
        const email = (e.email ?? "").toLowerCase();
        return userId.includes(q) || name.includes(q) || email.includes(q);
      })
      .slice(0, 20);

    return NextResponse.json({ results });
  } catch (err) {
    const msg = awsErrorMessage(err);
    console.error("[profile/search:s3]", msg);
    try {
      const results = await fallbackFirebaseSearch(q, authUserId);
      return NextResponse.json({ results, degraded: true });
    } catch (fallbackErr) {
      const fallbackMsg = awsErrorMessage(fallbackErr);
      console.error("[profile/search:firebase]", fallbackMsg);
      return NextResponse.json({ error: fallbackMsg }, { status: 502 });
    }
  }
}
