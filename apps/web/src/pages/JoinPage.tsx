import { ArrowRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { isValidPin, PIN_LENGTH } from "@gart/shared";
import { useLang } from "../i18n";

export function JoinPage() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const valid = isValidPin(pin);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (isValidPin(pin)) navigate(`/play/${pin}`);
  }

  return (
    <section className="m-auto w-full max-w-md">
      <div className="rounded-3xl border border-surface-border bg-surface p-6 shadow-2xl backdrop-blur sm:p-8">
        <h1 className="text-2xl font-bold sm:text-3xl">{t("join.title")}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t("join.subtitle")}</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="pin" className="mb-2 block text-sm font-medium">
              {t("join.pin")}
            </label>
            <input
              id="pin"
              name="pin"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d*"
              maxLength={PIN_LENGTH}
              value={pin}
              onChange={(e) => {
                setSubmitted(false);
                setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH));
              }}
              placeholder="000000"
              aria-describedby="pin-hint"
              aria-invalid={submitted && !valid}
              className="w-full rounded-2xl border border-surface-border bg-black/30 px-4 py-4 text-center font-mono text-3xl tracking-[0.4em] text-ink placeholder:text-white/20"
            />
            <p id="pin-hint" className="mt-2 text-xs text-ink-muted">
              {t("join.pinHint")}
            </p>
            {submitted && !valid && (
              <p role="alert" className="mt-2 text-sm text-red-300">
                {t("join.invalidPin")}
              </p>
            )}
          </div>

          <button
            type="submit"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-4 text-base font-semibold text-white shadow-lg shadow-brand/30 transition hover:brightness-110 active:scale-[0.99]"
          >
            {t("join.submit")}
            <ArrowRight className="size-5" aria-hidden />
          </button>
        </form>

      </div>
    </section>
  );
}
