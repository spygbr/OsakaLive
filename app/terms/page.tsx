import { Sidebar } from "@/components/Sidebar";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getLang } from "@/lib/i18n/server";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Osaka Live",
  description:
    "Terms governing your use of Osaka Live House Guide.",
  alternates: { canonical: "https://osaka-live.net/terms" },
};

const t = (lang: "en" | "ja", en: string, ja: string) => (lang === "ja" ? ja : en);

const EFFECTIVE_DATE = "2026-04-28";

export default async function TermsPage() {
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
            <span className="text-primary">{t(lang, "TERMS", "利用規約")}</span>
          </div>
          <div className="text-[10px] font-mono text-outline uppercase tracking-widest">
            {t(lang, `EFFECTIVE ${EFFECTIVE_DATE}`, `施行日 ${EFFECTIVE_DATE}`)}
          </div>
        </div>

        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="p-4 md:p-8 border-b border-outline-variant bg-surface-container">
          <h1 className="text-3xl md:text-5xl font-black font-headline tracking-tighter uppercase leading-none">
            {t(lang, "TERMS OF", "利用")} /{" "}
            <br className="hidden md:block" />
            <span className="text-primary">
              {t(lang, "SERVICE", "規約")}
            </span>
          </h1>
          <p className="mt-4 text-on-surface-variant font-mono text-xs max-w-2xl leading-relaxed uppercase">
            {t(
              lang,
              "THE RULES FOR USING OSAKA-LIVE.NET. WE LIST EVENTS — VENUES AND PROMOTERS RUN THEM. PLEASE READ.",
              "OSAKA-LIVE.NET ご利用上のルール。当サイトは情報掲載のみで、ライブの主催は会場・プロモーター側です。ご一読ください。",
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
                ["#acceptance", t(lang, "1. Acceptance", "1. 同意")],
                ["#service", t(lang, "2. The service", "2. サービス内容")],
                ["#accuracy", t(lang, "3. Information accuracy", "3. 情報の正確性")],
                ["#tickets", t(lang, "4. Tickets & venues", "4. チケット・会場")],
                ["#user-conduct", t(lang, "5. User conduct", "5. 利用者の行為")],
                ["#ip", t(lang, "6. Intellectual property", "6. 知的財産")],
                ["#third-party-content", t(lang, "7. Third-party content", "7. 第三者コンテンツ")],
                ["#disclaimers", t(lang, "8. Disclaimers", "8. 免責")],
                ["#liability", t(lang, "9. Liability", "9. 責任の制限")],
                ["#termination", t(lang, "10. Termination", "10. 利用停止")],
                ["#governing-law", t(lang, "11. Governing law", "11. 準拠法")],
                ["#changes", t(lang, "12. Changes", "12. 変更")],
                ["#contact", t(lang, "13. Contact", "13. お問い合わせ")],
              ].map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="hover:text-primary transition-colors">
                    → {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* 1. Acceptance */}
          <Section
            id="acceptance"
            num="01"
            title={t(lang, "Acceptance of these terms", "本規約への同意")}
            sub={t(lang, "同意", "Acceptance")}
          >
            <p>
              {t(
                lang,
                "By accessing or using osaka-live.net (the \"Service\"), you agree to these Terms of Service and our Privacy Policy. If you do not agree, please do not use the Service.",
                "osaka-live.net（以下「本サービス」）にアクセスまたは利用することで、本規約および当サイトのプライバシーポリシーに同意いただいたものとみなします。同意いただけない場合は本サービスをご利用にならないでください。",
              )}
            </p>
          </Section>

          {/* 2. Service */}
          <Section
            id="service"
            num="02"
            title={t(lang, "What the Service is", "サービスの内容")}
            sub={t(lang, "サービス", "Service")}
          >
            <p>
              {t(
                lang,
                "Osaka Live House Guide is an informational directory of live music events, venues, and artists in Osaka, Japan. We aggregate publicly available information from venues, promoters, and artists and present it bilingually (English / Japanese).",
                "「Osaka Live House Guide」は、大阪のライブ会場・出演者・公演情報をまとめたバイリンガル（英語・日本語）情報サイトです。会場・主催者・アーティストが公開している情報を集約し掲載しています。",
              )}
            </p>
            <p className="mt-4">
              {t(
                lang,
                "We are not a ticket seller, a promoter, or an agent of any venue or artist. We do not stage, organize, or operate any of the events listed.",
                "当サイトはチケット販売業者・主催者ではなく、会場やアーティストの代理人でもありません。掲載されているライブの企画・運営は行っていません。",
              )}
            </p>
          </Section>

          {/* 3. Accuracy */}
          <Section
            id="accuracy"
            num="03"
            title={t(lang, "Information accuracy", "情報の正確性")}
            sub={t(lang, "正確性", "Accuracy")}
          >
            <p>
              {t(
                lang,
                "We make reasonable efforts to keep listings accurate, but event details — date, time, lineup, ticket price, availability, drink fee — change frequently and may be updated, postponed, or cancelled by the venue or promoter without prior notice to us.",
                "可能な限り正確な情報の掲載に努めていますが、開催日・開演時刻・出演者・料金・販売状況・ドリンク代等は会場・主催者の都合で変更・延期・中止されることがあり、必ずしも当サイトに事前連絡があるとは限りません。",
              )}
            </p>
            <p className="mt-4 text-sm text-primary font-bold">
              {t(
                lang,
                "Always confirm event details directly with the venue or official ticket source before traveling.",
                "ご来場前に必ず会場または公式チケット販売元で詳細をご確認ください。",
              )}
            </p>
          </Section>

          {/* 4. Tickets */}
          <Section
            id="tickets"
            num="04"
            title={t(lang, "Tickets, venues, and refunds", "チケット・会場・返金")}
            sub={t(lang, "チケット", "Tickets")}
          >
            <p>
              {t(
                lang,
                "All ticket purchases are made directly between you and the venue, promoter, or third-party ticketing platform (e+, Ticket Pia, Lawson Ticket, Zaiko, etc.). We do not process payments and are not party to any sale.",
                "チケット購入は、お客様と会場・主催者・各チケット販売事業者（e+、チケットぴあ、ローソンチケット、Zaiko 等）との間の直接取引です。当サイトは決済処理を行わず、当該取引の当事者にもなりません。",
              )}
            </p>
            <p className="mt-4">
              {t(
                lang,
                "Refunds, cancellations, and changes are governed by the policies of the venue, promoter, or ticket platform from which you purchased. Please address such requests to them directly.",
                "返金・キャンセル・変更は購入元（会場・主催者・チケット販売事業者）の規定に従います。各購入元へ直接お問い合わせください。",
              )}
            </p>
          </Section>

          {/* 5. User conduct */}
          <Section
            id="user-conduct"
            num="05"
            title={t(lang, "Acceptable use", "利用者の行為")}
            sub={t(lang, "ルール", "Conduct")}
          >
            <p>{t(lang, "When using the Service, you agree not to:", "本サービスをご利用いただくにあたり、以下の行為は禁止します：")}</p>
            <ul className="list-disc pl-6 space-y-2 mt-4 marker:text-primary">
              <li>{t(lang, "Scrape, copy, or republish the Service in bulk without permission.", "許可なく一括取得・複製・再配信する行為。")}</li>
              <li>{t(lang, "Attempt to gain unauthorized access to systems or data.", "不正アクセスまたはその試み。")}</li>
              <li>{t(lang, "Interfere with the Service's operation (DoS, automated abuse, etc.).", "DoS攻撃や自動化された不正利用など、運営妨害行為。")}</li>
              <li>{t(lang, "Use the Service in violation of applicable law (Japanese or otherwise).", "適用される法令（日本法を含む）に違反する利用。")}</li>
              <li>{t(lang, "Misrepresent yourself or send false reports about events or venues.", "なりすまし、または虚偽の情報提供。")}</li>
            </ul>
          </Section>

          {/* 6. IP */}
          <Section
            id="ip"
            num="06"
            title={t(lang, "Intellectual property", "知的財産権")}
            sub={t(lang, "IP", "IP")}
          >
            <p>
              {t(
                lang,
                "The site's design, code, original editorial text (e.g., the First-Timer's Guide), and trademarks are owned by Osaka Live House Guide. You may view, share, and link to pages for personal, non-commercial purposes.",
                "サイトデザイン、コード、当サイト独自の編集記事（例：初心者ガイド）、商標等は「Osaka Live House Guide」に帰属します。個人的・非商用の閲覧・共有・リンクは可能です。",
              )}
            </p>
            <p className="mt-4">
              {t(
                lang,
                "Event titles, flyers, photographs, artist names, and venue names belong to their respective owners and are used here under fair-use / informational principles for the purpose of helping users discover live music. If you are a rights holder and want content removed, see contact below.",
                "イベント名・フライヤー・写真・出演者名・会場名等は各権利者に帰属し、ライブ情報案内の目的で公正利用の範囲で掲載しています。権利者の方で削除を希望される場合は下記までご連絡ください。",
              )}
            </p>
          </Section>

          {/* 7. Third-party content */}
          <Section
            id="third-party-content"
            num="07"
            title={t(lang, "Third-party links and content", "外部リンク・第三者コンテンツ")}
            sub={t(lang, "外部", "Third-party")}
          >
            <p>
              {t(
                lang,
                "The Service contains links to external sites (venue homepages, ticket platforms, social media, streaming services). We do not control these sites and are not responsible for their content, terms, or privacy practices. Visiting them is at your own risk.",
                "本サービスには外部サイト（会場サイト、チケット販売サイト、SNS、配信サービス等）へのリンクが含まれます。当サイトはこれらの内容・規約・プライバシーについて責任を負いません。閲覧は自己責任でお願いします。",
              )}
            </p>
          </Section>

          {/* 8. Disclaimers */}
          <Section
            id="disclaimers"
            num="08"
            title={t(lang, "Disclaimers", "免責")}
            sub={t(lang, "免責", "Disclaimer")}
          >
            <p className="uppercase font-mono text-xs leading-relaxed">
              {t(
                lang,
                "THE SERVICE IS PROVIDED \"AS IS\" AND \"AS AVAILABLE\" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, OR ACCURACY OF INFORMATION. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF HARMFUL COMPONENTS.",
                "本サービスは「現状有姿」で提供され、商品性、特定目的への適合性、非侵害、情報の正確性等について明示・黙示を問わず一切の保証をいたしません。サービスが中断なく、エラーなく、有害な要素なく提供されることを保証しません。",
              )}
            </p>
          </Section>

          {/* 9. Liability */}
          <Section
            id="liability"
            num="09"
            title={t(lang, "Limitation of liability", "責任の制限")}
            sub={t(lang, "責任", "Liability")}
          >
            <p className="uppercase font-mono text-xs leading-relaxed">
              {t(
                lang,
                "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, OSAKA LIVE HOUSE GUIDE AND ITS OPERATORS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF — OR INABILITY TO USE — THE SERVICE, OR FROM ANY EVENT YOU ATTEND BASED ON LISTINGS HERE.",
                "適用法令で認められる最大限の範囲において、当サイトおよび運営者は、本サービスの利用または利用不能、もしくは当サイトの掲載情報に基づき参加されたライブに起因する間接的・付随的・特別・結果的・懲罰的損害、利益・データ・信用の逸失について一切責任を負いません。",
              )}
            </p>
            <p className="mt-4 text-sm">
              {t(
                lang,
                "Nothing in these Terms limits liability that cannot be excluded under applicable law (including Japan's Consumer Contract Act in the case of consumer users).",
                "適用法令上排除できない責任（日本国消費者契約法に基づく消費者の権利等）は本規約により制限されません。",
              )}
            </p>
          </Section>

          {/* 10. Termination */}
          <Section
            id="termination"
            num="10"
            title={t(lang, "Suspension and termination", "利用停止")}
            sub={t(lang, "停止", "Termination")}
          >
            <p>
              {t(
                lang,
                "We may suspend or terminate access to the Service for any user who violates these Terms or applicable law, with or without notice. We may also discontinue the Service, in whole or in part, at any time.",
                "本規約または法令に違反した利用者に対し、事前通知の有無にかかわらず本サービスの利用を停止または終了することがあります。また、本サービスの全部または一部を予告なく中止することがあります。",
              )}
            </p>
          </Section>

          {/* 11. Governing law */}
          <Section
            id="governing-law"
            num="11"
            title={t(lang, "Governing law and jurisdiction", "準拠法・裁判管轄")}
            sub={t(lang, "準拠法", "Law")}
          >
            <p>
              {t(
                lang,
                "These Terms are governed by the laws of Japan, without regard to conflict-of-laws principles. The Osaka District Court shall have exclusive jurisdiction as the court of first instance for any dispute arising out of or in connection with the Service or these Terms.",
                "本規約は日本法に準拠し、解釈されます。本サービスまたは本規約に起因または関連する紛争については、大阪地方裁判所を第一審の専属的合意管轄裁判所とします。",
              )}
            </p>
          </Section>

          {/* 12. Changes */}
          <Section
            id="changes"
            num="12"
            title={t(lang, "Changes to these terms", "本規約の変更")}
            sub={t(lang, "変更", "Updates")}
          >
            <p>
              {t(
                lang,
                "We may update these Terms from time to time. The \"Effective\" date at the top of the page reflects the latest version. Continued use of the Service after changes take effect constitutes acceptance of the updated Terms.",
                "本規約は随時改定されることがあります。最新版の施行日はページ上部に表示します。改定後も継続して本サービスをご利用された場合、改定後の規約に同意いただいたものとみなします。",
              )}
            </p>
          </Section>

          {/* 13. Contact */}
          <Section
            id="contact"
            num="13"
            title={t(lang, "Contact", "お問い合わせ")}
            sub={t(lang, "連絡先", "Contact")}
          >
            <p>
              {t(
                lang,
                "Questions about these Terms, or takedown / correction requests, can be sent to:",
                "本規約に関するお問い合わせ・削除依頼・訂正依頼は以下までお願いします：",
              )}
            </p>
            <pre className="bg-surface-container-lowest border border-outline-variant p-4 text-xs whitespace-pre-wrap mt-4">
{`Osaka Live House Guide
hello@osaka-live.net`}
            </pre>
          </Section>

          {/* Footer */}
          <div className="border-t border-outline-variant pt-8 text-center text-sm text-on-surface-variant">
            <p className="font-mono text-[10px] uppercase tracking-widest">
              {t(lang, `Effective ${EFFECTIVE_DATE}`, `施行日 ${EFFECTIVE_DATE}`)}
            </p>
            <p className="mt-2">
              <Link href="/privacy" className="text-primary hover:underline font-headline uppercase tracking-tighter">
                {t(lang, "→ Privacy Policy", "→ プライバシーポリシー")}
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
