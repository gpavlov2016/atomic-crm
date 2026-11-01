import { useQuery } from "@tanstack/react-query";
import { useNotify, useTranslate } from "ra-core";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSupabaseClient } from "../providers/supabase/supabase";

export const GmailConnectionCard = () => {
  if (import.meta.env.VITE_IS_DEMO === "true") return null;
  return <GmailConnectionCardContent />;
};

const GmailConnectionCardContent = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const [searchParams, setSearchParams] = useSearchParams();
  const reportedResult = useRef<string | null>(null);
  const [pending, setPending] = useState<"connect" | "disconnect" | null>(null);
  const statusQuery = useQuery({
    queryKey: ["gmail-connection"],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient()
        .from("gmail_connection_status")
        .select("google_email, connected_at")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { refetch } = statusQuery;
  useEffect(() => {
    const result = searchParams.get("gmail");
    if (!result) {
      reportedResult.current = null;
      return;
    }
    if (reportedResult.current === result) return;
    reportedResult.current = result;
    if (result === "connected") {
      notify("crm.profile.gmail.connected_success", {
        type: "success",
        messageArgs: { _: "Gmail connected" },
      });
      void refetch();
    } else {
      notify("crm.profile.gmail.callback_error", {
        type: "error",
        messageArgs: { _: "Gmail connection was not completed." },
      });
    }
    const next = new URLSearchParams(searchParams);
    next.delete("gmail");
    setSearchParams(next, { replace: true });
  }, [notify, refetch, searchParams, setSearchParams]);

  const connect = async () => {
    setPending("connect");
    const { data, error } = await getSupabaseClient().functions.invoke<{
      url: string;
    }>("gmail-oauth/start", { method: "POST" });
    if (error || !data?.url) {
      setPending(null);
      notify("crm.profile.gmail.connect_error", {
        type: "error",
        messageArgs: { _: "Could not start the Gmail connection. Try again." },
      });
      return;
    }
    window.location.assign(data.url);
  };

  const disconnect = async () => {
    setPending("disconnect");
    const { error } = await getSupabaseClient().functions.invoke(
      "gmail-oauth/disconnect",
      { method: "POST" },
    );
    setPending(null);
    if (error) {
      notify("crm.profile.gmail.disconnect_error", {
        type: "error",
        messageArgs: { _: "Could not disconnect Gmail. Try again." },
      });
      return;
    }
    notify("crm.profile.gmail.disconnected", {
      type: "success",
      messageArgs: { _: "Gmail disconnected" },
    });
    await statusQuery.refetch();
  };

  const connectedEmail = statusQuery.data?.google_email;

  return (
    <Card>
      <CardContent>
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-muted-foreground">
            {translate("crm.profile.gmail.title", { _: "Gmail" })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {translate("crm.profile.gmail.description", {
              _: "Connect your Gmail account so an assistant can search, read, and send mail as you.",
            })}
          </p>
          {statusQuery.isError ? (
            <p className="text-sm text-destructive">
              {translate("crm.profile.gmail.status_error", {
                _: "Could not load the Gmail connection.",
              })}
            </p>
          ) : null}
          {statusQuery.isPending ? null : connectedEmail ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium">
                {translate("crm.profile.gmail.connected", {
                  _: "Connected as %{email}",
                  email: connectedEmail,
                })}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={pending !== null}
                onClick={() => void disconnect()}
              >
                {translate("crm.profile.gmail.disconnect", {
                  _: "Disconnect",
                })}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={pending !== null}
              onClick={() => void connect()}
            >
              {translate("crm.profile.gmail.connect", { _: "Connect Gmail" })}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
