export class GmailNotConnected extends Error {
  constructor(message = "Gmail is not connected") {
    super(message);
    this.name = "GmailNotConnected";
  }
}

export class GmailAccountAmbiguous extends Error {
  emails: string[];

  constructor(emails: string[]) {
    super("Multiple Gmail accounts are connected. Pass googleEmail.");
    this.name = "GmailAccountAmbiguous";
    this.emails = emails;
  }
}

type MailboxRef = {
  google_email: string;
};

export function pickGmailConnection<T extends MailboxRef>(
  rows: T[],
  googleEmail: string | undefined,
): T {
  const requested = googleEmail?.trim().toLowerCase();
  if (requested) {
    const match = rows.find(
      (row) => row.google_email.toLowerCase() === requested,
    );
    if (!match) {
      throw new GmailNotConnected("That Gmail account is not connected");
    }
    return match;
  }
  if (rows.length === 0) throw new GmailNotConnected();
  if (rows.length === 1) return rows[0];
  throw new GmailAccountAmbiguous(rows.map((row) => row.google_email));
}
