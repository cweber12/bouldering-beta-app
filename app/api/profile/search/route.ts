import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId, readProfileStorage, listProfileStorage } from "../../s3/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IndexEntry {
  displayName?: string;
  email?: string;
  location?: string;
}

const INDEX_FOLDER = "ProfileData/_index";

// ---------------------------------------------------------------------------
// GET — search users by displayName or email (query param: q)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authUserId = await getAuthUserId();
  if (!authUserId) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) {
    return NextResponse.json({ error: "Search query must be at least 2 characters." }, { status: 400 });
  }
  if (q.length > 200) {
    return NextResponse.json({ error: "Search query too long." }, { status: 400 });
  }

  try {
    // List all index files
    const fileNames = await listProfileStorage(INDEX_FOLDER);

    // Read index entries in parallel (capped at 50 to limit concurrency)
    const entries = await Promise.all(
      fileNames.slice(0, 50).map(async (fileName) => {
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
        const name = (e.displayName ?? "").toLowerCase();
        const email = (e.email ?? "").toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .slice(0, 20);

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[profile/search]", err);
    return NextResponse.json({ error: "Search failed." }, { status: 502 });
  }
}
