import { Sidebar } from "@/components/Sidebar";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getLang } from "@/lib/i18n/server";

export const metadata = {
  title: "First-Timer's Guide | Osaka Live",
  description:
    "Everything you need to walk into a Namba Bears, Hokage, or Pangea show — tickets, drink fee, etiquette, phrases.",
};

const t = (lang: "en" | "ja", en: string, ja: string) => (lang === "ja" ? ja : en);

export default async function GuidePage() {
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
            <span className="text-primary">{t(lang, "GUIDE", "ガイド")}</span>
          </div>
          <div className="text-[10px] font-mono text-outline uppercase tracking-widest">
            {t(lang, "FIRST_TIMER_HANDBOOK", "初心者ハンドブック")}
          </div>
        </div>

        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="p-4 md:p-8 border-b border-outline-variant bg-surface-container">
          <h1 className="text-3xl md:text-5xl font-black font-headline tracking-tighter uppercase leading-none">
            {t(lang, "FIRST-TIMER'S", "初めての")} /{" "}
            <br className="hidden md:block" />
            <span className="text-primary">
              {t(lang, "GUIDE", "ライブハウス・ガイド")}
            </span>
          </h1>
          <p className="mt-4 text-on-surface-variant font-mono text-xs max-w-2xl leading-relaxed uppercase">
            {t(
              lang,
              "EVERYTHING YOU NEED TO WALK INTO A NAMBA BEARS, HOKAGE, OR PANGEA SHOW — WHETHER IT'S YOUR FIRST GIG IN JAPAN OR YOUR FIRST GIG ANYWHERE.",
              "難波ベアーズ、ホカゲ、パンゲアでのライブを楽しむために、知っておきたい全てを。",
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
                ["#tickets", t(lang, "1. Buying the ticket", "1. チケットの買い方")],
                ["#drink", t(lang, "2. The drink ticket", "2. ドリンク代")],
                ["#cash", t(lang, "3. Bring cash", "3. 現金を持参")],
                ["#doors", t(lang, "4. Doors, start, merch", "4. 開場・開演・物販")],
                ["#manners", t(lang, "5. Inside the venue", "5. 会場内のマナー")],
                ["#after", t(lang, "6. After the show", "6. ライブ終了後")],
                ["#phrases", t(lang, "7. Useful phrases", "7. 便利な日本語")],
                ["#venues", t(lang, "8. Venue notes", "8. 会場別の注意点")],
                ["#checklist", t(lang, "9. Checklist", "9. チェックリスト")],
              ].map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="hover:text-primary transition-colors">
                    → {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {/* 1. Tickets */}
          <Section
            id="tickets"
            num="01"
            title={t(lang, "Buying the ticket", "チケットの買い方")}
            sub={t(lang, "ライブ前", "Before the show")}
          >
            <H3>{t(lang, "Three ways tickets are sold", "3つの購入方法")}</H3>

            <p>
              <strong>{t(lang, "A. Major ticket play-guides", "A. 大手プレイガイド")}</strong>{" "}
              — {t(lang, "for mid-tier and bigger shows.", "中規模以上のライブ向け。")}
            </p>
            <table className="w-full text-sm border border-outline-variant my-4">
              <thead className="bg-surface-container-lowest font-mono text-[10px] uppercase tracking-widest text-outline">
                <tr>
                  <th className="text-left p-2 border-b border-outline-variant">
                    {t(lang, "Service", "サービス")}
                  </th>
                  <th className="text-left p-2 border-b border-outline-variant">
                    {t(lang, "Where", "購入場所")}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="p-2 border-b border-outline-variant">eplus (e+)</td><td className="p-2 border-b border-outline-variant">eplus.jp / FamilyMart Famiport</td></tr>
                <tr><td className="p-2 border-b border-outline-variant">Ticket Pia</td><td className="p-2 border-b border-outline-variant">t.pia.jp / FamilyMart</td></tr>
                <tr><td className="p-2 border-b border-outline-variant">Lawson Ticket (L-tike)</td><td className="p-2 border-b border-outline-variant">l-tike.com / Lawson Loppi</td></tr>
                <tr><td className="p-2">Zaiko</td><td className="p-2">zaiko.io {t(lang, "(indie-friendly)", "(インディー向け)")}</td></tr>
              </tbody>
            </table>

            <p className="mt-6">
              <strong>{t(lang, "B. Direct reservation", "B. 直接予約")}</strong> (<code>WEBチケット予約</code> / <code>メール予約</code>) — {t(
                lang,
                "the underground default. The band/venue holds your name at the door; you pay cash on entry.",
                "アンダーグラウンドの定番。バンドや会場に名前を伝え、当日現金払い。",
              )}
            </p>

            <p className="mt-6">
              <strong>{t(lang, "C. Same-day at the door", "C. 当日券")}</strong> (<code>当日券</code>, <em>tōjitsu-ken</em>) — {t(
                lang,
                "usually ¥500 more than advance. Cash only. Sold-out is rare except for special bills.",
                "前売りより500円程度高め。現金のみ。特別な公演以外、売り切れは稀。",
              )}
            </p>

            <H3 className="mt-8">{t(lang, "Reservation message template", "予約メッセージのテンプレート")}</H3>
            <pre className="bg-surface-container-lowest border border-outline-variant p-4 text-xs whitespace-pre-wrap">
{`はじめまして。[日付] の [バンド名] のライブを予約したいです。
名前: [Your name]
人数: [Number of people]
よろしくお願いします。

Hi, I'd like to reserve [N] ticket(s) for [Band] on [date].
Name: [Your name]. Thank you.`}
            </pre>
          </Section>

          {/* 2. Drink */}
          <Section
            id="drink"
            num="02"
            title={t(lang, "The drink ticket", "ドリンク代")}
            sub={t(lang, "ドリンク代", "Drink fee")}
          >
            <p>
              {t(
                lang,
                "Every Japanese live house charges a separate ¥500–¥700 drink fee on top of the ticket. This isn't a scam — it's how Japanese liquor licensing works. The venue is officially a bar that happens to have bands.",
                "日本のライブハウスでは、チケット代とは別に500〜700円のドリンク代が必要です。これは法律上、ライブハウスが「飲食店」として営業しているためです。",
              )}
            </p>
            <ol className="list-decimal pl-6 space-y-2 mt-4 marker:text-primary">
              <li>{t(lang, "Pay the drink fee at the door — get a coin or paper ticket (ドリンクチケット).", "入口でドリンク代を払い、コインまたは券を受け取る。")}</li>
              <li>{t(lang, "Take it to the bar inside — between sets, after the show, whenever.", "好きなタイミングでバーに持っていく。")}</li>
              <li>{t(lang, "Exchange for a drink — beer, soft drink, water, oolong tea.", "ビール、ソフトドリンク、水、ウーロン茶などと交換。")}</li>
            </ol>
            <p className="mt-4 text-sm text-on-surface-variant">
              {t(
                lang,
                "Tip: don't lose the coin. No coin = no drink. Don't drink alcohol? Ask for お茶 (oolong tea) or お水 (water).",
                "ヒント:コインを無くさないこと。お酒を飲まない方は「お茶」または「お水」と伝えてください。",
              )}
            </p>
          </Section>

          {/* 3. Cash */}
          <Section
            id="cash"
            num="03"
            title={t(lang, "Bring cash", "現金を持参")}
            sub={t(lang, "現金", "Cash only")}
          >
            <p>
              {t(
                lang,
                "Most Osaka live houses are cash-only for door fees, drinks, and merch. ATMs at 7-Eleven and Lawson take foreign cards.",
                "ほとんどの大阪のライブハウスは現金のみ。セブンイレブンやローソンのATMで海外カードも使えます。",
              )}
            </p>
            <ul className="list-disc pl-6 space-y-1 mt-4 text-sm marker:text-primary">
              <li>{t(lang, "Ticket: ¥2,000–¥4,500 (indie / underground)", "チケット: 2,000〜4,500円（インディー/アンダーグラウンド）")}</li>
              <li>{t(lang, "Drink: ¥600", "ドリンク代: 600円")}</li>
              <li>{t(lang, "Merch: ¥1,500–¥3,500 per item", "グッズ: 1点 1,500〜3,500円")}</li>
              <li>{t(lang, "Coin lockers: ¥400–¥700", "コインロッカー: 400〜700円")}</li>
            </ul>
            <p className="mt-4 text-sm text-primary font-bold">
              {t(lang, "Bring small bills. Door staff hate breaking ¥10,000 notes.", "小銭を用意。スタッフは1万円札のお釣りが苦手です。")}
            </p>
          </Section>

          {/* 4. Doors */}
          <Section
            id="doors"
            num="04"
            title={t(lang, "Doors, start time, and merch", "開場・開演・物販")}
            sub={t(lang, "開場・開演・物販", "Doors, start, merch")}
          >
            <p>
              {t(lang, "You'll see two times listed:", "2つの時刻が書かれています:")}
            </p>
            <ul className="list-disc pl-6 space-y-1 mt-4 marker:text-primary">
              <li><strong>開場 (kaijō)</strong> — {t(lang, "doors open", "開場時刻")}</li>
              <li><strong>開演 (kaien)</strong> — {t(lang, "show starts", "開演時刻")}</li>
            </ul>
            <p className="mt-4">
              {t(
                lang,
                "Doors usually open 30 minutes before show time. Show start times are EXACT — a 19:00 start means the first band hits the stage at 19:00:00.",
                "通常、開場は開演の30分前。開演時刻は厳守 — 19:00開演なら19:00ちょうどに最初のバンドが登場します。",
              )}
            </p>
            <p className="mt-4">
              <strong>{t(lang, "Order of entry", "入場順")}:</strong>{" "}
              {t(
                lang,
                "larger venues call you in by reservation number — listen for 「〇番から〇番までお入りください」.",
                "大きな会場では予約番号順に呼ばれます。「〇番から〇番までお入りください」をよく聞いて。",
              )}
            </p>
            <p className="mt-4">
              <strong>{t(lang, "Merch (物販, bussan)", "物販")}:</strong>{" "}
              {t(
                lang,
                "sold by bands themselves at a table near the entrance. Cash. The musicians often run their own table — buying merch is also how you say 'I liked the set.'",
                "出演者自身が入口付近のテーブルで販売。現金のみ。グッズを買うことは「良かった」を伝える一つの方法です。",
              )}
            </p>
          </Section>

          {/* 5. Manners */}
          <Section
            id="manners"
            num="05"
            title={t(lang, "Inside the venue", "会場内のマナー")}
            sub={t(lang, "マナー", "Manners")}
          >
            <ul className="list-disc pl-6 space-y-3 marker:text-primary">
              <li>{t(lang, "No talking during sets. Whoops and applause yes; conversation no. Take chatter outside.", "演奏中の私語はNG。歓声や拍手はOK、会話は外で。")}</li>
              <li>{t(lang, "No phone screens up. A quick photo is usually fine; filming a whole song is not. Always check for a 撮影禁止 (no-photo) sign.", "スマホ画面を上げない。短い写真はOK、長時間撮影はNG。「撮影禁止」の表示を必ず確認。")}</li>
              <li>{t(lang, "Personal space. Even at hard shows, the pit is more controlled than in the West. Read the room.", "パーソナルスペースを尊重。激しいライブでも欧米よりは穏やか。空気を読んで。")}</li>
              <li>{t(lang, "Hands-up = enthusiastic, not aggressive. Standard Japanese audience response is intense focus + polite clapping. They are into it.", "手を上げる=熱狂のサイン。日本の観客は集中して聴き、礼儀正しく拍手します。")}</li>
              <li>{t(lang, "Don't leave during a band's set. Wait for the gap. If you must, walk along the wall.", "演奏中に退出しない。どうしても必要なら壁沿いに移動。")}</li>
            </ul>
          </Section>

          {/* 6. After */}
          <Section
            id="after"
            num="06"
            title={t(lang, "After the show", "ライブ終了後")}
            sub={t(lang, "終了後", "Afterwards")}
          >
            <ul className="list-disc pl-6 space-y-3 marker:text-primary">
              <li>{t(lang, "The band hangs out at the merch table. Say よかったです (yokatta desu — \"that was great\"). A few words go very far.", "出演者は物販ブースにいます。「よかったです」の一言が嬉しい。")}</li>
              <li>{t(lang, "Last train (終電, shūden) — Osaka subways stop ~midnight; JR slightly later. Check before the show. Use GO Taxi app if needed.", "終電 — 地下鉄は0時頃、JRは少し遅め。事前に確認。タクシーは「GO」アプリが便利。")}</li>
              <li>{t(lang, "Drinks after? Izakaya around Amerikamura, Namba, and Kitashinchi stay open late.", "二次会は?アメ村・難波・北新地周辺の居酒屋が夜遅くまで営業。")}</li>
            </ul>
          </Section>

          {/* 7. Phrases */}
          <Section
            id="phrases"
            num="07"
            title={t(lang, "Useful Japanese phrases", "便利な日本語フレーズ")}
            sub={t(lang, "フレーズ集", "Phrases")}
          >
            <table className="w-full text-sm border border-outline-variant">
              <thead className="bg-surface-container-lowest font-mono text-[10px] uppercase tracking-widest text-outline">
                <tr>
                  <th className="text-left p-2 border-b border-outline-variant">English</th>
                  <th className="text-left p-2 border-b border-outline-variant">日本語</th>
                  <th className="text-left p-2 border-b border-outline-variant">Romaji</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Reservation under [name]", "[名前]で予約しています", "[name] de yoyaku shite imasu"],
                  ["One ticket, please", "チケット1枚お願いします", "chiketto ichi-mai onegai shimasu"],
                  ["Same-day ticket", "当日券", "tōjitsu-ken"],
                  ["Beer please", "ビールお願いします", "bīru onegai shimasu"],
                  ["Oolong tea (no alcohol)", "ウーロン茶お願いします", "ūron-cha onegai shimasu"],
                  ["Is photography OK?", "撮影してもいいですか？", "satsuei shite mo ii desu ka?"],
                  ["Where's the merch table?", "物販はどこですか？", "bussan wa doko desu ka?"],
                  ["That was great", "よかったです", "yokatta desu"],
                  ["Excuse me / sorry", "すみません", "sumimasen"],
                  ["Thank you", "ありがとうございます", "arigatō gozaimasu"],
                  ["English menu?", "英語のメニューありますか？", "eigo no menyū arimasu ka?"],
                  ["What time does it end?", "何時に終わりますか？", "nan-ji ni owarimasu ka?"],
                ].map(([en, ja, romaji]) => (
                  <tr key={en} className="border-b border-outline-variant last:border-0">
                    <td className="p-2 align-top">{en}</td>
                    <td className="p-2 align-top">{ja}</td>
                    <td className="p-2 align-top text-on-surface-variant font-mono text-xs">{romaji}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          {/* 8. Venues */}
          <Section
            id="venues"
            num="08"
            title={t(lang, "Venue-specific notes", "会場別の注意点")}
            sub={t(lang, "会場別", "Per venue")}
          >
            <dl className="space-y-4">
              {[
                ["Namba Bears", t(lang, "Basement, no phone signal, no lockers, one Japanese-style toilet, brutally loud. Bring earplugs. ~¥3,000 + ¥600 drink. Cash only.", "地下、電波なし、ロッカーなし、和式トイレ1つ、爆音。耳栓推奨。約3,000円+ドリンク代600円。現金のみ。")],
                ["Hokage", t(lang, "Metal/punk leaning. Loud. Door entry by reservation list, then numbered.", "メタル/パンク寄り。爆音。予約順に番号で入場。")],
                ["Pangea", t(lang, "Friendlier first-timer venue. ~200 capacity, decent sightlines.", "初心者にも優しい会場。約200名、見やすい配置。")],
                ["CONPASS", t(lang, "Already English-friendly, has English menus, wheelchair access. Easiest first show if you're nervous.", "英語対応・英語メニュー・バリアフリー。初めてのライブに最適。")],
                ["Zeela / Shangri-La (Umeda)", t(lang, "Bigger (300–350), more touring acts, more conventional concert-hall feel. Tickets often via play-guide.", "300〜350名収容。ツアーバンドが多く、コンサートホール的な雰囲気。プレイガイド経由が多い。")],
                ["Varon, BRONZE, Bears", t(lang, "True underground. Direct reservation, cash, no English. Worth it.", "本物のアンダーグラウンド。直接予約、現金、英語なし。挑戦の価値あり。")],
              ].map(([name, desc]) => (
                <div key={name} className="border-l-2 border-primary pl-4">
                  <dt className="font-bold font-headline uppercase tracking-tighter">{name}</dt>
                  <dd className="text-sm text-on-surface-variant mt-1">{desc}</dd>
                </div>
              ))}
            </dl>
          </Section>

          {/* 9. Checklist */}
          <Section
            id="checklist"
            num="09"
            title={t(lang, "Quick first-timer checklist", "初心者チェックリスト")}
            sub={t(lang, "チェックリスト", "Checklist")}
          >
            <ul className="space-y-2 font-mono text-sm">
              {[
                t(lang, "Reserved the show (or confirmed door tickets)", "予約済み（または当日券あり）"),
                t(lang, "¥5,000+ in cash, small bills", "5,000円以上の現金（小銭含む）"),
                t(lang, "ID for age-restricted shows", "年齢制限のあるライブ用の身分証"),
                t(lang, "Earplugs (especially Bears, Hokage)", "耳栓（特にベアーズ・ホカゲ）"),
                t(lang, "Last train time checked", "終電時刻を確認"),
                t(lang, "Phone fully charged / offline maps", "スマホ満充電、オフライン地図"),
                t(lang, "Show start time confirmed (it's exact)", "開演時刻を確認（厳守）"),
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="text-primary">[ ]</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Section>

          {/* Footer */}
          <div className="border-t border-outline-variant pt-8 text-center text-sm text-on-surface-variant">
            <p>
              {t(
                lang,
                "Need help in the moment? Ask: ",
                "困ったら一言: ",
              )}
              <code className="text-primary">すみません、英語話せますか？</code>
            </p>
            <p className="mt-4 font-headline uppercase tracking-tighter text-on-surface">
              {t(lang, "Have fun. Buy merch. Say ", "楽しんで。グッズを買って。")}
              <span className="text-primary">よかったです</span>.
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

function H3({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={`font-headline uppercase tracking-tighter text-lg mt-6 ${className}`}
    >
      {children}
    </h3>
  );
}
