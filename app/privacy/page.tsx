import { Sidebar } from "@/components/Sidebar";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getLang } from "@/lib/i18n/server";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Osaka Live",
  description:
    "How Osaka Live House Guide collects, uses, and protects your information.",
  alternates: { canonical: "https://osaka-live.net/privacy" },
};

const t = (lang: "en" | "ja", en: string, ja: string) => (lang === "ja" ? ja : en);

const EFFECTIVE_DATE = "2026-04-28";

export default async function PrivacyPage() {
  const lang = await getLang();

  return (
    <>
      <Sidebar />
      <main className="flex-1 bg-surface-dim pb-20 md:pb-0 overflow-x-hidden">
        {/* ── Breadcrumb ────────────────────────────────────────── */}
        <div className="hidden md:flex items-center justify-between px-8 py-4 border-b border-outline-variant bg-surface-container-lowest">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-outline">
            <Link href="/" className="hover:text-primary transition-colors">
              {t(lang, "ROOT", "ホーム")}
            </Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-primary">{t(lang, "PRIVACY", "プライバシー")}</span>
          </div>
          <div className="text-[10px] font-mono text-outline uppercase tracking-widest">
            {t(lang, `EFFECTIVE ${EFFECTIVE_DATE}`, `施行日 ${EFFECTIVE_DATE}`)}
          </div>
        </div>

        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="p-4 md:p-8 border-b border-outline-variant bg-surface-container">
          <h1 className="text-3xl md:text-5xl font-black font-headline tracking-tighter uppercase leading-none">
            {t(lang, "PRIVACY", "プライバシー")} /{" "}
            <br className="hidden md:block" />
            <span className="text-primary">
              {t(lang, "POLICY", "ポリシー")}
            </span>
          </h1>
          <p className="mt-4 text-on-surface-variant font-mono text-xs max-w-2xl leading-relaxed uppercase">
            {t(
              lang,
              "HOW OSAKA LIVE HOUSE GUIDE HANDLES YOUR INFORMATION. SHORT VERSION: WE DON'T REQUIRE ACCOUNTS, WE DON'T SELL YOUR DATA, AND WE COLLECT THE MINIMUM NEEDED TO RUN THE SITE.",
              "「Osaka Live House Guide」がどのように情報を扱うかについて。要点：アカウント登録不要、データ販売なし、サイト運営に必要な最小限の情報のみ取得。",
            )}
          </p>
        </section>

        {/* ── Body ──────────────────────────────────────────────── */}
        <article className="px-4 md:px-8 py-8 max-w-4xl mx-auto space-y-12 text-on-surface">
          {/* TOC */}
          <nav className="border border-outline-variant bg-surface-container-lowest p-4">
            <h2 className="font-mono text-[10px] uppercase tracking-widest text-outline mb-3">
              {t(lang, "CONTENTS", "目次")}
            </h2>
            <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm font-mono">
              {[
                ["#who", t(lang, "1. Who we are", "1. 運営者")],
                ["#what", t(lang, "2. What we collect", "2. 取得する情報")],
                ["#why", t(lang, "3. Why we collect it", "3. 利用目的")],
                ["#cookies", t(lang, "4. Cookies", "4. クッキー")],
                ["#third-parties", t(lang, "5. Third parties", "5. 第三者")],
                ["#retention", t(lang, "6. Retention", "6. 保存期間")],
                ["#rights", t(lang, "7. Your rights", "7. 利用者の権利")],
                ["#children", t(lang, "8. Children", "8. 未成年")],
                ["#changes", t(lang, "9. Changes", "9. 変更")],
                ["#contact", t(lang, "10. Contact", "10. お問い合わせ")],
              ].map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="hover:text-primary transition-colors">
                    → {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* 1. Who we are */}
          <Section
            id="who"
            num="01"
            title={t(lang, "Who we are", "運営者について")}
            sub={t(lang, "運営者", "Operator")}
          >
            <p>
              {t(
                lang,
                "Osaka Live House Guide (\"we,\" \"us,\" \"the site\") is a bilingual live music discovery platform for Osaka's underground music scene, operated at osaka-live.net.",
                "「Osaka Live House Guide」（以下「当サイト」）は、大阪のアンダーグラウンド音楽シーンを紹介するバイリンガルのライブ情報サイトで、osaka-live.net にて運営しています。",
              )}
            </p>
            <p>
              {t(
                lang,
                "This Privacy Policy explains what information we collect, how we use it, and the choices you have. It applies to your use of osaka-live.net and any related services.",
                "本ポリシーは、取得する情報、利用方法、利用者が選択できる事項を定めるものです。osaka-live.net および関連サービスの利用に適用されます。",
              )}
            </p>
          </Section>

          {/* 2. What we collect */}
          <Section
            id="what"
            num="02"
            title={t(lang, "What we collect", "取得する情報")}
            sub={t(lang, "情報", "Data")}
          >
            <p>
              {t(
                lang,
                "We try to collect as little as possible. Specifically:",
                "可能な限り取得を抑えています。具体的には以下のとおりです：",
              )}
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4 marker:text-primary">
              <li>
                <strong>{t(lang, "Language preference", "言語設定")}</strong> —{" "}
                {t(
                  lang,
                  "stored in a `lang` cookie (1 year) so the site renders in EN or JA on your next visit.",
                  "次回アクセス時に英語/日本語表示を維持するため、`lang` クッキー（1年間）に保存します。",
                )}
              </li>
              <li>
                <strong>{t(lang, "Server access logs", "サーバーアクセスログ")}</strong> —{" "}
                {t(
                  lang,
                  "our hosting provider (Vercel) records standard request data including IP address, user agent, and timestamp for security and reliability.",
                  "ホスティング業者（Vercel）が、セキュリティと安定運用のため、IPアドレス・ユーザーエージェント・日時等の標準的なリクエスト情報を記録します。",
                )}
              </li>
              <li>
                <strong>{t(lang, "Aggregate usage data", "集計利用データ")}</strong> —{" "}
                {t(
                  lang,
                  "anonymous, non-identifying performance metrics (page response times, error rates) used to keep the site running.",
                  "ページ応答時間・エラー率など、個人を特定しない匿名の運用指標。",
                )}
              </li>
              <li>
                <strong>{t(lang, "Voluntary submissions", "任意の送信情報")}</strong> —{" "}
                {t(
                  lang,
                  "if you contact us by email, we receive whatever you send (your email address, message contents).",
                  "お問い合わせメールを送信いただいた場合、送信元メールアドレスと本文を受領します。",
                )}
              </li>
            </ul>
            <p className="mt-4 text-sm text-primary font-bold">
              {t(
                lang,
                "We do not require accounts. We do not collect names, addresses, phone numbers, or payment information.",
                "アカウント登録は不要です。氏名・住所・電話番号・決済情報は取得しません。",
              )}
            </p>
          </Section>

          {/* 3. Why */}
          <Section
            id="why"
            num="03"
            title={t(lang, "Why we collect it", "利用目的")}
            sub={t(lang, "目的", "Purpose")}
          >
            <ul className="list-disc pl-6 space-y-2 marker:text-primary">
              <li>{t(lang, "Show the site in your preferred language.", "選択された言語でサイトを表示するため。")}</li>
              <li>{t(lang, "Operate, maintain, and secure osaka-live.net.", "osaka-live.net の運営・保守・セキュリティのため。")}</li>
              <li>{t(lang, "Diagnose errors and improve performance.", "エラー検知と性能改善のため。")}</li>
              <li>{t(lang, "Respond to messages you send us.", "お問い合わせへの対応のため。")}</li>
            </ul>
            <p className="mt-4">
              {t(
                lang,
                "We do not use your information for advertising, profiling, or sale to third parties.",
                "広告・プロファイリング・第三者への販売には利用しません。",
              )}
            </p>
          </Section>

          {/* 4. Cookies */}
          <Section
            id="cookies"
            num="04"
            title={t(lang, "Cookies", "クッキー")}
            sub={t(lang, "クッキー", "Cookies")}
          >
            <p>
              {t(
                lang,
                "We use one functional cookie:",
                "当サイトでは以下の機能性クッキーを使用しています：",
              )}
            </p>
            <table className="w-full text-sm border border-outline-variant my-4">
              <thead className="bg-surface-container-lowest font-mono text-[10px] uppercase tracking-widest text-outline">
                <tr>
                  <th className="text-left p-2 border-b border-outline-variant">{t(lang, "Name", "名称")}</th>
                  <th className="text-left p-2 border-b border-outline-variant">{t(lang, "Purpose", "目的")}</th>
                  <th className="text-left p-2 border-b border-outline-variant">{t(lang, "Lifetime", "保存期間")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-2 border-b border-outline-variant font-mono">lang</td>
                  <td className="p-2 border-b border-outline-variant">{t(lang, "Remembers EN/JA language choice", "言語設定（英/日）の保持")}</td>
                  <td className="p-2 border-b border-outline-variant">{t(lang, "1 year", "1年")}</td>
                </tr>
              </tbody>
            </table>
            <p>
              {t(
                lang,
                "You can clear cookies at any time through your browser settings. Doing so will reset your language to the site default on next visit.",
                "ブラウザ設定からいつでも削除可能です。削除した場合、次回アクセス時の言語は初期設定に戻ります。",
              )}
            </p>
          </Section>

          {/* 5. Third parties */}
          <Section
            id="third-parties"
            num="05"
            title={t(lang, "Third-party services", "第三者サービス")}
            sub={t(lang, "第三者", "Third parties")}
          >
            <p>
              {t(
                lang,
                "The site relies on the following providers, who may process limited information on our behalf:",
                "当サイトは以下のサービス事業者を利用しており、これらの事業者は当サイトに代わり一部情報を処理することがあります：",
              )}
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4 marker:text-primary">
              <li>
                <strong>Vercel</strong> — {t(lang, "hosting and edge delivery (USA / global).", "ホスティング・エッジ配信（米国／グローバル）。")}
              </li>
              <li>
                <strong>Supabase</strong> — {t(lang, "database for event listings (Tokyo region, ap-northeast-1).", "イベントデータの保管（東京リージョン、ap-northeast-1）。")}
              </li>
              <li>
                <strong>{t(lang, "Embedded venue/artist links", "外部リンク（会場・アーティスト）")}</strong> —{" "}
                {t(
                  lang,
                  "external sites we link to (venue pages, ticket platforms, social media) have their own privacy policies. We have no control over them.",
                  "リンク先（会場ページ、チケット販売、SNS等）はそれぞれ独自のポリシーに従います。当サイトは関与しません。",
                )}
              </li>
            </ul>
          </Section>

          {/* 6. Retention */}
          <Section
            id="retention"
            num="06"
            title={t(lang, "Data retention", "保存期間")}
            sub={t(lang, "保存期間", "Retention")}
          >
            <ul className="list-disc pl-6 space-y-2 marker:text-primary">
              <li>{t(lang, "Server access logs: up to 30 days, then aggregated or deleted.", "アクセスログ：最大30日。以降は集計化または削除。")}</li>
              <li>{t(lang, "Email correspondence: kept while needed to handle the inquiry, then deleted.", "メール：問い合わせ対応に必要な期間保管後、削除します。")}</li>
              <li>{t(lang, "The `lang` cookie expires automatically after 1 year.", "`lang` クッキー：1年で自動的に失効。")}</li>
            </ul>
          </Section>

          {/* 7. Rights */}
          <Section
            id="rights"
            num="07"
            title={t(lang, "Your rights", "利用者の権利")}
            sub={t(lang, "権利", "Rights")}
          >
            <p>
              {t(
                lang,
                "Depending on where you live, you may have rights under Japan's Act on the Protection of Personal Information (APPI), the EU/UK GDPR, or the California Consumer Privacy Act (CCPA/CPRA), including the right to:",
                "お住まいの地域により、個人情報保護法（日本）、EU/英国GDPR、または米カリフォルニア州CCPA/CPRA等に基づき、以下の権利が認められる場合があります：",
              )}
            </p>
            <ul className="list-disc pl-6 space-y-1 mt-4 marker:text-primary">
              <li>{t(lang, "Access the personal data we hold about you", "保有個人データへのアクセス")}</li>
              <li>{t(lang, "Request correction of inaccurate data", "不正確な情報の訂正請求")}</li>
              <li>{t(lang, "Request deletion of your data", "削除請求")}</li>
              <li>{t(lang, "Object to or restrict processing", "処理の制限・異議申立")}</li>
              <li>{t(lang, "Lodge a complaint with a supervisory authority", "監督機関への申立")}</li>
            </ul>
            <p className="mt-4">
              {t(
                lang,
                "To exercise any of these rights, email us using the contact below. We will respond within 30 days.",
                "上記の権利を行使される場合、下記窓口までメールにてご連絡ください。30日以内に対応します。",
              )}
            </p>
          </Section>

          {/* 8. Children */}
          <Section
            id="children"
            num="08"
            title={t(lang, "Children's privacy", "未成年について")}
            sub={t(lang, "未成年", "Children")}
          >
            <p>
              {t(
                lang,
                "The site is intended for a general audience and is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal data, please contact us and we will delete it.",
                "当サイトは一般の方向けであり、13歳未満を対象としていません。13歳未満の個人情報を意図的に取得することはありません。万一、13歳未満の方の情報が送信された場合は、お知らせいただければ削除します。",
              )}
            </p>
          </Section>

          {/* 9. Changes */}
          <Section
            id="changes"
            num="09"
            title={t(lang, "Changes to this policy", "ポリシーの変更")}
            sub={t(lang, "変更", "Updates")}
          >
            <p>
              {t(
                lang,
                "We may update this policy from time to time. Material changes will be reflected in the \"Effective\" date at the top of the page. Continued use of the site after a change constitutes acceptance of the updated policy.",
                "本ポリシーは随時更新されることがあります。重要な変更はページ冒頭の「施行日」に反映します。変更後も継続利用された場合、変更内容に同意いただいたものとみなします。",
              )}
            </p>
          </Section>

          {/* 10. Contact */}
          <Section
            id="contact"
            num="10"
            title={t(lang, "Contact", "お問い合わせ")}
            sub={t(lang, "連絡先", "Contact")}
          >
            <p>
              {t(
                lang,
                "Privacy questions or requests can be sent to:",
                "プライバシーに関するお問い合わせは以下までお願いします：")}
            </p>
            <pre className="bg-surface-container-lowest border border-outline-variant p-4 text-xs whitespace-pre-wrap mt-4">
{`Osaka Live House Guide
privacy@osaka-live.net`}
            </pre>
          </Section>

          {/* Footer */}
          <div className="border-t border-outline-variant pt-8 text-center text-sm text-on-surface-variant">
            <p className="font-mono text-[10px] uppercase tracking-widest">
              {t(lang, `Effective ${EFFECTIVE_DATE}`, `施行日 ${EFFECTIVE_DATE}`)}
            </p>
            <p className="mt-2">
              <Link href="/terms" className="text-primary hover:underline font-headline uppercase tracking-tighter">
                {t(lang, "→ Terms of Service", "→ 利用規約")}
              </Link>
            </p>
          </div>
        </article>
      </main>
    </>
  );
}

/* ── Helpers ────────────────────────────────────────────────── */

function Section({
  id,
  num,
  title,
  sub,
  children,
}: {
  id: string;
  num: string;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <header className="flex items-baseline gap-4 border-b border-outline-variant pb-3 mb-6">
        <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
          {num}
        </span>
        <h2 className="text-2xl md:text-3xl font-black font-headline tracking-tighter uppercase">
          {title}
        </h2>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-outline hidden md:inline">
          {sub}
        </span>
      </header>
      <div className="space-y-4 leading-relaxed">{children}</div>
    </section>
  );
}
