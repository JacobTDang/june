/**
 * A stand-in for the Supabase client in tests of server code. Each table
 * answers every read with its rows (the filters are recorded, not applied,
 * since RLS is the database's job), so a test sets a table to what RLS would
 * return for the caller.
 */

export interface FakeCall {
  table: string;
  method: string;
  args: unknown[];
}

type Reply = { data: unknown; error: null };
type SingleReply = Reply | { data: null; error: { code: string; message: string; details: string } };

/** What PostgREST's `.single()` answers when the query matched no row. */
const NO_ROW_ERROR = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
  details: "The result contains 0 rows",
};

interface Chain extends PromiseLike<Reply> {
  select(...args: unknown[]): Chain;
  eq(...args: unknown[]): Chain;
  order(...args: unknown[]): Chain;
  limit(...args: unknown[]): Chain;
  single(): Promise<SingleReply>;
  maybeSingle(): Promise<Reply>;
  insert(rows: unknown): Promise<{ error: null }>;
}

export function fakeSupabase(tables: Record<string, unknown[]>, user: { id: string } | null = { id: "user-1" }) {
  const calls: FakeCall[] = [];

  function from(table: string): Chain {
    const rows = tables[table] ?? [];
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    const chain: Chain = {
      select: record("select"),
      eq: record("eq"),
      order: record("order"),
      limit: record("limit"),
      single: async () => (rows.length === 0 ? { data: null, error: NO_ROW_ERROR } : { data: rows[0], error: null }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      insert: async (inserted) => {
        calls.push({ table, method: "insert", args: [inserted] });
        return { error: null };
      },
      then: (onFulfilled, onRejected) => Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected),
    };
    return chain;
  }

  return {
    client: { from, auth: { getUser: async () => ({ data: { user } }) } },
    calls,
    /** The arguments of every call to one method on one table. */
    argsOf: (table: string, method: string) =>
      calls.filter((c) => c.table === table && c.method === method).map((c) => c.args),
  };
}
