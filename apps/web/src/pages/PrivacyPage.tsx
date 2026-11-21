import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DEFAULT_PRIVACY, type Privacy } from "@gart/shared";
import { api } from "../api";
import { useBranding } from "../branding";
import { useLang, type MessageKey } from "../i18n";
import { Card } from "../ui";

/** Public page: what data the site keeps and for how long. Text is fixed and true to the code; the owner adds a contact and a note. */
export function PrivacyPage() {
  const { t } = useLang();
  const { branding } = useBranding();
  const [p, setP] = useState<Privacy>(DEFAULT_PRIVACY);
  useEffect(() => { api<{ privacy: Privacy }>("/api/privacy").then((r) => setP(r.privacy)).catch(() => undefined); }, []);
  const company = branding.companyName || t("app.name");
  const sections: [MessageKey, string][] = [
    ["priv.players.h", t("priv.players.p")],
    ["priv.admins.h", t("priv.admins.p")],
    ["priv.ip.h", t("priv.ip.p")],
    ["priv.ret.h", p.retentionDays > 0 ? t("priv.ret.days").replace("{days}", String(p.retentionDays)) : t("priv.ret.forever")],
    ["priv.third.h", t("priv.third.p")],
    ["priv.rights.h", t("priv.rights.p")],
  ];
  return (
    <article className="mx-auto w-full max-w-2xl space-y-5" data-testid="privacy">
      <h1 className="text-3xl font-bold">{t("priv.title")}</h1>
      <p className="text-ink-muted">{t("priv.intro")}</p>
      <Card className="space-y-2">
        <h2 className="text-lg font-bold">{t("priv.owner.h")}</h2>
        <p>{t("priv.owner.p").replace("{company}", company)}</p>
        <p data-testid="privacy-contact">{p.contact ? t("priv.owner.contact").replace("{contact}", p.contact) : t("priv.owner.nocontact")}</p>
      </Card>
      {sections.map(([h, body]) => (
        <Card key={h} className="space-y-2"><h2 className="text-lg font-bold">{t(h)}</h2><p>{body}</p></Card>
      ))}
      {p.note ? <Card className="space-y-2"><h2 className="text-lg font-bold">{t("priv.extra.h")}</h2><p className="whitespace-pre-line">{p.note}</p></Card> : null}
      <p><Link to="/" className="text-sm text-ink-muted underline underline-offset-2 hover:text-ink">{t("play.back")}</Link></p>
    </article>
  );
}
