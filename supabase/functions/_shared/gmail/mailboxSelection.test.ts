import { describe, expect, it } from "vitest";
import {
  GmailAccountAmbiguous,
  GmailNotConnected,
  pickGmailConnection,
} from "./mailboxSelection";

const row = (google_email: string) => ({ google_email, id: google_email });

describe("pickGmailConnection", () => {
  const rows = [row("One@example.com"), row("two@example.com")];

  it("matches a requested address without regard to case or surrounding space", () => {
    expect(pickGmailConnection(rows, "  ONE@example.com ").google_email).toBe(
      "One@example.com",
    );
  });

  it("rejects an address that is not linked and does not list the others", () => {
    expect(() => pickGmailConnection(rows, "missing@example.com")).toThrow(
      GmailNotConnected,
    );
    try {
      pickGmailConnection(rows, "missing@example.com");
    } catch (error) {
      expect(error).toBeInstanceOf(GmailNotConnected);
      expect((error as Error).message).toBe(
        "That Gmail account is not connected",
      );
      expect(error).not.toBeInstanceOf(GmailAccountAmbiguous);
    }
  });

  it("reports that Gmail is not connected when nothing is linked", () => {
    expect(() => pickGmailConnection([], undefined)).toThrow(
      new GmailNotConnected(),
    );
  });

  it("uses the only linked account when no address is given", () => {
    expect(pickGmailConnection([rows[0]], "  ").google_email).toBe(
      "One@example.com",
    );
  });

  it("asks for an address when several accounts are linked", () => {
    expect(() => pickGmailConnection(rows, undefined)).toThrow(
      GmailAccountAmbiguous,
    );
    try {
      pickGmailConnection(rows, undefined);
    } catch (error) {
      expect(error).toBeInstanceOf(GmailAccountAmbiguous);
      expect((error as GmailAccountAmbiguous).emails).toEqual([
        "One@example.com",
        "two@example.com",
      ]);
    }
  });
});
