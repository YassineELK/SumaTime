export type Member = { id: string; user_id: string | null; email: string; name: string; role: 'admin' | 'partner'; active: number };
export type Client = { id: string; name: string; active: number };
export type Entry = { id: string; member_id: string; client_id: string; client: string; member: string; ticket: string; date: string; start: number; end: number; description: string; billed: number; version: number };
export type State = { me: Member | null; setup?: boolean; denied?: boolean; email?: string; clients: Client[]; members: Member[]; entries: Entry[] };
