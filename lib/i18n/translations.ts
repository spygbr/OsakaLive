export type Lang = 'en' | 'ja'

export const translations = {
  // ── Navigation ──────────────────────────────────────────────────────────
  nav_home:      { en: 'HOME',      ja: 'ホーム' },
  nav_calendar:  { en: 'CALENDAR',  ja: 'カレンダー' },
  nav_venues:    { en: 'VENUES',    ja: '会場' },
  nav_artists:   { en: 'ARTISTS',   ja: 'アーティスト' },
  nav_tickets:   { en: 'TICKETS',   ja: 'チケット' },
  nav_lang:      { en: 'JP',        ja: 'EN' },
  nav_filterBtn: { en: 'FILTER / 検索', ja: 'フィルター / 検索' },

  // ── Home page ────────────────────────────────────────────────────────────
  home_featuredShows:      { en: 'Featured Shows',            ja: '注目ライブ' },
  home_featuredSubtitle:   { en: 'Select_Highlights / 注目ライブ', ja: 'セレクト_ハイライト / SELECT HIGHLIGHTS' },
  home_happeningTonight:   { en: 'HAPPENING TONIGHT',         ja: '今夜開催' },
  home_happeningSubtitle:  { en: 'HAPPENING TONIGHT / 今夜開催', ja: '今夜開催 / HAPPENING TONIGHT' },
  home_upcoming:           { en: 'UPCOMING',                  ja: '今後の予定' },
  home_upcomingSubtitle:   { en: 'UPCOMING / 今後の予定',       ja: '今後の予定 / UPCOMING' },
  home_liveNow:            { en: 'LIVE NOW',                  ja: 'ライブ中' },
  home_checkCalendar:      { en: 'CHECK CALENDAR',            ja: 'カレンダー確認' },
  home_noEventsTonight:    { en: 'No events tonight',         ja: '今夜のイベントはありません' },
  home_browseUpcoming:     { en: 'Browse Upcoming →',         ja: '今後のイベントを見る →' },
  home_viewAllUpcoming:    { en: 'VIEW ALL UPCOMING EVENTS →', ja: '全ての今後のイベントを見る →' },
  home_browseByDistrict:   { en: 'BROWSE BY DISTRICT',        ja: '地域別ブラウズ' },
  home_browseSubtitle:     { en: 'BROWSE BY DISTRICT / 地域別', ja: '地域別 / BROWSE BY DISTRICT' },
  home_moreEventsSoon:     { en: 'More events coming soon',   ja: 'イベント情報は近日公開予定' },
  home_featured:           { en: 'FEATURED',                  ja: '注目' },

  // ── Search page ──────────────────────────────────────────────────────────
  search_heading:          { en: 'UPCOMING SHOWS',            ja: '今後のライブ' },
  search_subheading:       { en: 'ライブスケジュール',          ja: 'LIVE SCHEDULE' },
  search_filtered:         { en: 'EVENTS MATCH YOUR FILTERS. USE THE SIDEBAR TO ADJUST.', ja: '件のイベントが条件に一致します。サイドバーで調整してください。' },
  search_archiving:        { en: 'UPCOMING EVENTS IN THE GREATER OSAKA METROPOLITAN AREA. ALL TIMES JST.', ja: '件の今後のイベントを掲載中。大阪市内全域、時刻はJST。' },
  search_sortDate:         { en: 'SORT: [DATE_ASC]',          ja: 'ソート: [日付昇順]' },
  search_noMatch:          { en: 'NO EVENTS MATCH THE CURRENT FILTERS.', ja: '条件に一致するイベントはありません。' },
  search_noEvents:         { en: 'No upcoming events found.', ja: '今後のイベントは見つかりませんでした。' },
  search_clearFilters:     { en: 'CLEAR FILTERS →',           ja: 'フィルターをクリア →' },
  search_viewDetails:      { en: 'VIEW DETAILS',              ja: '詳細を見る' },
  search_liveHouse:        { en: 'LIVE HOUSE',                ja: 'ライブハウス' },

  // ── Event detail ─────────────────────────────────────────────────────────
  event_date:              { en: 'DATE',                      ja: '日付' },
  event_time:              { en: 'TIME',                      ja: '時間' },
  event_venue:             { en: 'VENUE',                     ja: '会場' },
  event_price:             { en: 'PRICE',                     ja: '価格' },
  event_details:           { en: 'EVENT DETAILS',             ja: 'イベント詳細' },
  event_lineup:            { en: 'LINEUP',                    ja: '出演者' },
  event_timetable:         { en: 'TIMETABLE',                 ja: 'タイムテーブル' },
  event_doorsOpen:         { en: 'DOORS OPEN',                ja: '開場' },
  event_headliner:         { en: 'HEADLINER',                 ja: 'ヘッドライナー' },
  event_support:           { en: 'SUPPORT',                   ja: 'サポート' },
  event_specialGuest:      { en: 'SPECIAL GUEST',             ja: 'スペシャルゲスト' },
  event_advTicket:         { en: 'ADVANCE TICKET',            ja: '前売り' },
  event_reserveTicket:     { en: 'RESERVE TICKET',            ja: 'チケット予約' },
  event_soldOut:           { en: 'SOLD OUT',                  ja: '売り切れ' },
  event_ticketsAtDoor:     { en: 'TICKETS AT DOOR',           ja: '当日券' },
  event_freeEntry:         { en: 'FREE ENTRY',                ja: '入場無料' },
  event_reserveNote:       { en: 'RESERVATIONS CLOSE AT 15:00 ON THE DAY OF THE EVENT.', ja: '予約は当日15:00で締め切ります。' },
  event_venueInfo:         { en: 'VENUE INFORMATION',         ja: '会場情報' },
  event_openInMaps:        { en: 'OPEN IN MAPS',              ja: '地図を開く' },
  event_venueWebsite:      { en: 'VENUE WEBSITE',             ja: '会場ウェブサイト' },
  event_shareEvent:        { en: 'SHARE EVENT',               ja: 'シェア' },
  event_open:              { en: 'OPEN',                      ja: '開場' },
  event_start:             { en: 'START',                     ja: '開演' },

  // ── Availability labels ───────────────────────────────────────────────────
  avail_available:         { en: 'AVAILABLE',                 ja: '予約可能' },
  avail_limited:           { en: 'LIMITED',                   ja: '残りわずか' },
  avail_soldOut:           { en: 'SOLD OUT',                  ja: '売り切れ' },
  avail_free:              { en: 'FREE',                      ja: '無料' },

  // ── Artists page ─────────────────────────────────────────────────────────
  artists_heading:         { en: 'ARTIST DIRECTORY',          ja: 'アーティスト一覧' },
  artists_subheading:      { en: 'アーティスト',               ja: 'ARTIST DIRECTORY' },
  artists_root:            { en: 'ROOT',                      ja: 'ルート' },
  artists_index:           { en: 'INDEX: [A-Z]',              ja: 'インデックス: [A-Z]' },
  artists_database:        { en: 'DATABASE OF',               ja: 'データベース：' },
  artists_performers:      { en: 'ACTIVE PERFORMERS IN THE KANSAI UNDERGROUND SCENE.', ja: '名のアクティブなアーティストが関西アンダーグラウンドシーンに所属。' },
  artists_noUpcoming:      { en: 'No upcoming events',        ja: '今後のイベントはありません' },
  artists_upcomingEvents:  { en: 'UPCOMING EVENTS',           ja: '今後のイベント' },
  artists_genre:           { en: 'GENRE',                     ja: 'ジャンル' },
  artists_searchPlaceholder: { en: 'SEARCH ARTISTS...', ja: 'アーティストを検索...' },
  artists_noResults:       { en: 'No artists match your search.', ja: '条件に一致するアーティストはいません。' },

  // ── Calendar page ────────────────────────────────────────────────────────
  calendar_heading:        { en: 'LIVE CALENDAR',             ja: 'ライブカレンダー' },
  calendar_subheading:     { en: 'ライブカレンダー',           ja: 'LIVE CALENDAR' },
  calendar_noEvents:       { en: 'No events this month.',     ja: '今月のイベントはありません。' },
  calendar_eventsOnDate:   { en: 'Events on',                 ja: 'イベント：' },

  // ── Sidebar ──────────────────────────────────────────────────────────────
  sidebar_filterSystem:    { en: 'FILTER SYSTEM',             ja: 'フィルター' },
  sidebar_version:         { en: 'V.2.04_ARCHIVE',            ja: 'V.2.04_アーカイブ' },
  sidebar_clear:           { en: 'CLEAR',                     ja: 'クリア' },
  sidebar_date:            { en: 'DATE / 日程',                ja: '日程 / DATE' },
  sidebar_allUpcoming:     { en: 'ALL UPCOMING',              ja: '全て' },
  sidebar_tonight:         { en: 'TONIGHT / 今夜',            ja: '今夜 / TONIGHT' },
  sidebar_weekend:         { en: 'WEEKEND / 週末',            ja: '週末 / WEEKEND' },
  sidebar_area:            { en: 'AREA / エリア',             ja: 'エリア / AREA' },
  sidebar_allAreas:        { en: 'ALL AREAS',                 ja: '全エリア' },
  sidebar_genre:           { en: 'GENRE / ジャンル',          ja: 'ジャンル / GENRE' },
  sidebar_price:           { en: 'PRICE / 価格',              ja: '価格 / PRICE' },
  sidebar_all:             { en: 'ALL',                       ja: '全て' },
  sidebar_free:            { en: 'FREE',                      ja: '無料' },
  sidebar_paid:            { en: 'PAID',                      ja: '有料' },
  sidebar_active:          { en: 'ACTIVE',                    ja: 'アクティブ' },

  // ── Breadcrumbs ──────────────────────────────────────────────────────────
  breadcrumb_root:         { en: 'ROOT',                      ja: 'ルート' },
  breadcrumb_events:       { en: 'EVENTS',                    ja: 'イベント' },
  breadcrumb_artists:      { en: 'ARTISTS',                   ja: 'アーティスト' },
  breadcrumb_filtered:     { en: '— FILTERED',                ja: '— フィルター中' },

  // ── Common ───────────────────────────────────────────────────────────────
  common_details:          { en: 'DETAILS →',                 ja: '詳細 →' },
  common_adv:              { en: 'ADV',                       ja: '前売' },
  common_promo:            { en: 'PROMO',                     ja: 'プロモ' },
  common_genre:            { en: 'GENRE',                     ja: 'ジャンル' },
  common_price:            { en: 'PRICE',                     ja: '価格' },
  common_start:            { en: 'START',                     ja: '開演' },
  common_open:             { en: 'OPEN',                      ja: '開場' },
  common_status:           { en: 'STATUS',                    ja: 'ステータス' },

  // ── Footer ───────────────────────────────────────────────────────────────
  footer_copyright:        { en: '©2024 OSAKA LIVE HOUSE GUIDE. ALL RIGHTS RESERVED. Unauthorized duplication is a violation of applicable laws.', ja: '©2024 大阪ライブハウスガイド. 無断複製禁止。' },
  footer_sitemap:          { en: 'Sitemap',                   ja: 'サイトマップ' },
  footer_privacy:          { en: 'Privacy Policy',            ja: 'プライバシーポリシー' },
  footer_contact:          { en: 'Contact',                   ja: 'お問い合わせ' },
  footer_terms:            { en: 'Terms of Service',          ja: '利用規約' },
  footer_venueSubmission:  { en: 'Venue Submission',          ja: '会場登録' },
  footer_artistPortal:     { en: 'Artist Portal',             ja: 'アーティストポータル' },
  footer_stamp:            { en: 'STAMP: VERIFIED_OSAKA_HUB', ja: 'スタンプ: 認証済_大阪ハブ' },
} as const

export type TranslationKey = keyof typeof translations

/** Pure function — works in both server and client contexts */
export function createT(lang: Lang) {
  return (key: TranslationKey): string => translations[key][lang]
}
