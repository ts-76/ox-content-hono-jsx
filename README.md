# Ox Content Hono JSX adapter

Ox Content の HTML host API を Hono JSX に接続する独立パッケージです。
Markdown / MDX の変換・部品の検出・仮想モジュール・CSS の収集・HMR は Ox Content に任せ、
このパッケージは Hono JSX の SSR と `hono/jsx/dom` での部品起動・破棄を担当します。

Ox Content とは独立した、非公式の Hono JSX アダプターです。
Ox Content 3.8.2 / Hono 4.13.16 / Vite 8.3.5 で検証しています。

## インストール

```sh
npm install @ts-76/ox-content-hono-jsx hono
npm install -D @ox-content/vite-plugin@3.8.2 vite@8.3.5
```

アプリの通常操作は `npm run dev` / `npm run build` / `npm run preview` です。
アプリ側の手動 Markdown compile や生成ファイルの管理は不要です。

リポジトリのサンプルを動かす場合は、先にローカルパッケージをビルドします。

```sh
npm ci --ignore-scripts --omit=peer
npm run build
cd examples/basic
npm install --ignore-scripts --omit=peer
npm run dev
```

## 基本の使い方

通常のコンテンツサイトでは `oxContentHono()` を追加します。
ルート、HTML host、JSX、部品 registry、client entry、ビルド入力、CSS の接続をまとめて設定します。
アプリ側に host / client ファイルを作る必要はありません。

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { oxContentHono } from "@ts-76/ox-content-hono-jsx/vite";

export default defineConfig({
  plugins: [
    oxContentHono({
      oxContent: { srcDir: "content" },
      frontmatter: ({ title }) => ({ title: title ?? "" }),
    }),
  ],
});
```

`content/index.mdx` は `/`、`content/guide.md` は `/guide/` になります。
パスの決定や文書の検出は Ox Content の collection API に従います。
通常の `vite` / `vite build` / `vite preview` で動きます。
既存のビルド入力は追加した仮想 client entry と併せて維持します。

既定ではハイライト、resources、docs、検索、feeds、siteMaps を無効にしています。
対応する機能を使う場合は `oxContent` に明示して設定してください。
`honoJsx()` を追加で併用する必要はありません。

### Markdown を Hono コンポーネントとして import

`.md` / `.markdown` / `.mdx` の default export は Hono の非同期サーバーコンポーネントです。
`frontmatter` と `toc` も named export で取得できます。
frontmatter は Ox Content のパーサーを使うため、配列・ネストした YAML も維持します。

```tsx
/// <reference types="@ts-76/ox-content-hono-jsx/virtual" />
import Page, { frontmatter } from "../content/page.mdx";

app.get("/page", (c) =>
  c.html(
    <article>
      <h1>{String(frontmatter.title)}</h1>
      <Page />
    </article>,
  ),
);
```

生成モジュールには Vite や Markdown コンパイラーを含めません。
ブラウザー entry からの import はエラーになります。ブラウザーには文書内の island だけを配信します。
文書内の部品 import は Ox Content の content root 制限に従います。
`.md?raw` など、Vite の query 付き読み込みは変換対象外です。

既存アプリがルーティングとアセット配信を担当する場合は `routes: false` を指定します。
この場合は自動ルートもビルド入力の追加も行わず、既存アプリの構成を保ちます。
部品を起動するアプリの browser entry で `import "virtual:ox-content-hono/client"` を使ってください。
文書の検出対象は content collection、layout の静的 import、SSR 変換済みの文書です。
独自の複数段ビルドで content 外の文書を追加する場合は、低レベル registry API で対象を明示できます。
CSS のリンクと client bundle の配信は、そのアプリの Vite アセット処理に従います。

### Hono の document layout

`layout` に Hono コンポーネントの module path を指定できます。
`children` は描画済み本文、`head` は CSS / script タグです。両方を出力してください。
加えて `frontmatter` と `path` を受け取れます。

```ts
oxContentHono({
  layout: "./src/Layout.tsx",
  oxContent: { srcDir: "content" },
});
```

```tsx
import type { Child } from "hono/jsx";
import Footer from "./footer.md";

export default function Layout({
  children,
  head,
}: {
  children: Child;
  head: Child;
}) {
  return (
    <html>
      <head>{head}</head>
      <body>
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
```

layout の静的 import から文書を検出し、文書内の部品も browser registry に含めます。
動的に組み立てた import path や `import.meta.glob` の解析は行いません。
完成例は [examples/basic](examples/basic) にあります。

## 独自 HTML host への接続

既存の低レベル API も引き続き使えます。
[examples/custom-host](examples/custom-host) は元の接続方法を維持した例です。

### Vite

既存の Ox Content custom host に `honoJsx()` を追加します。
`oxContent` のオプションはホストと共有してください。

```ts
import { defineConfig } from "vite";
import { oxContentCustomHost } from "@ox-content/vite-plugin";
import { honoJsx } from "@ts-76/ox-content-hono-jsx/vite";

const oxContent = { srcDir: "content", highlight: false };
export default defineConfig({
  appType: "mpa",
  plugins: [
    ...honoJsx({ oxContent }),
    ...oxContentCustomHost({
      host: "./src/host.ts",
      oxContent,
      build: { transformHtml: false },
      dev: { routeDependencies: [{ path: "content", kind: "directory" }] },
    }),
  ],
  build: { manifest: true, rollupOptions: { input: "src/client.ts" } },
});
```

`appType: 'mpa'` は生成 HTML を通常の `vite preview` で配信するための設定です。
`build.transformHtml: false` は、Ox Content 3.4.0 のビルド用一時 Vite サーバーが
開発用 `/@vite/client` を静的 HTML に挿入することを防ぎます。
ホストの head / CSS / client entry は Ox Content の document assets API で組み立てます。
独自の `transformIndexHtml` 処理が必要なホストは、この設定と出力を確認してください。

### ホストの描画

custom host の `ctx.markdown.render()` 内で接続します。
ルーティング、公開対象の選択、ページ全体のレイアウトは引き続きホストが担当します。
完成した例は [examples/custom-host/src/host.ts](examples/custom-host/src/host.ts) を参照してください。

```ts
import { renderHonoMarkdown } from "@ts-76/ox-content-hono-jsx/vite";

const page = await ctx.markdown.render({
  source,
  documentPath,
  renderHtml(markdown) {
    return renderHonoMarkdown({
      context: markdown,
      frontmatter: { title: markdown.transform.frontmatter.title ?? "" },
      documentAssets: {
        clientEntries: markdown.transform.components?.length
          ? ["src/client.ts"]
          : [],
      },
    });
  },
});
```

`page.metadata.documentAssets.headHtml` を `<head>` に、`page.html` を本文に入れます。
`page.dependencies` をルートの依存に戻すと、ソースや CSS の変更が開発中に反映されます。
部品がないページでは client entry を指定せず、生成 HTML を JavaScript なしにできます。

### ブラウザー

```ts
/// <reference types="@ts-76/ox-content-hono-jsx/virtual" />
import modules from "virtual:ox-content-hono/modules";
import { initHonoIslands } from "@ts-76/ox-content-hono-jsx/client";

const controller = initHonoIslands({ modules });
if (import.meta.hot) import.meta.hot.dispose(() => controller.destroy());
```

Ox Content の module registry を利用し、必要な部品だけを読み込みます。
読み込み中の破棄、存在しない部品、読み込み失敗は汎用 host API の診断・キャンセルに従います。
`options.onError` で module / render エラーを受け取れます。

### Markdown / MDX

```mdx
---
title: Example
---

import Counter from "./Counter.tsx";

# Example

<Counter initial={2} client:visible>

Slot **Markdown**.

</Counter>
```

通常の MDX import 構文を使用します。`client:load`（既定）、`client:idle`、
`client:visible`、`client:media="(max-width: 600px)"` を指定できます。
起動のスケジューリング自体は Ox Content の islands runtime が担当します。
1部品につき起動条件は1つです。未対応の directive はエラーにします。

部品は `hono/jsx` で記述し、CSS を普通に import できます。

```tsx
import { useState } from "hono/jsx";
import { useFrontmatter } from "@ts-76/ox-content-hono-jsx";
import "./counter.css";

export default function Counter({ initial = 0 }) {
  const [count, setCount] = useState(initial);
  const { title } = useFrontmatter<{ title: string }>();
  return (
    <button onClick={() => setCount(count + 1)}>
      {title}: {count}
    </button>
  );
}
```

## API と依存境界

| エントリー     | 役割                                                            |
| -------------- | --------------------------------------------------------------- |
| パッケージ直下 | `FrontmatterContext` / `useFrontmatter()`                       |
| `/server`      | `createHonoServerAdapter()`。Ox Content に渡す SSR callback     |
| `/client`      | `createHonoHydrate()` / `initHonoIslands()`。起動と破棄         |
| `/vite`        | `oxContentHono()` と既存 `honoJsx()` / renderer。ビルド時の接続 |
| `/virtual`     | 仮想 module registry の型宣言                                   |

通常依存は `@ox-content/islands` だけです。Hono は peer dependency、Vite と
`@ox-content/vite-plugin` は `/vite` を使うホストの build dependency です。
ブラウザーバンドルに N-API / Vite / Markdown compiler を含めないことを packed consumer で検査します。
`hono-markdown`・Void・hono-decks・honoxpress への依存はありません。

## frontmatter と信頼境界

- `frontmatter` は既定で空です。ホストが選んだ JSON 値だけを SSR とブラウザーに同じ形で渡します。
- 選んだ値は HTML 内の inert JSON script に入ります。秘密情報を選択しないでください。
- `<` / `>` / `&` を JSON 内でエスケープし、`</script>` を含む文字列でも script を閉じないようにします。
- Markdown / MDX と部品 import、元の slot HTML は信頼できるビルド入力として扱います。
  このアダプターは CMS 本文の安全化や任意 JavaScript のサンドボックスではありません。
- Hono DOM は SSR の DOM を再利用する hydration ではなく、起動時に対象 island の中身を置き換えます。
  読み込み前・JavaScript 無効時は SSR の表示が残ります。
- ブラウザーで起動する部品は同期コンポーネントにしてください。
  必要な非同期データはホストで取得して props に渡します。
- CSS import と静的 Markdown slot を対象とします。Hono の head 自動収集、`hono/css`、
  slot 内の多重フレームワーク island、HonoX / Void 専用フックは未検証です。

## 上流のビルド用依存の監査

Ox Content 3.8.2 の依存ツリーには、fflate の ZIP64 展開と KaTeX の既存 prototype pollution を前提とした勧告が残ります。
2026-11-03 の監査表示は伝播分を含め Moderate 5 / Low 2、High / Critical は0です。上流が固定している依存のため、override で差し替えていません。
Satori が使う fflate の API は `inflateSync` で、今回の勧告の対象である `unzipSync` ではありません。
KaTeX の問題は別の prototype pollution と組み合わさる条件があります。
ビルド設定・Markdown・部品は信頼できる入力として扱い、CMS の未検証本文を処理する用途には使わないでください。

これらは本パッケージの通常依存ではなく、Vite 用 peer dependency を導入する開発・ビルド環境の依存です。
検証では SSR / browser bundle に Markdown compiler を含めない境界も確認します。
この説明は依存監査がゼロであることを意味しません。既知の勧告は
[fflate](https://github.com/advisories/GHSA-px8p-9vwx-vf98) /
[KaTeX](https://github.com/advisories/GHSA-238p-pmpm-9mq7) を参照してください。

追加で、上流の `glob@13.0.6` と `minimatch@10.2.6` に指摘が残ります。
glob は AbortSignal による中断後もファイル探索を続ける問題で、修正版は14.0.2以降です。
minimatch は特定のパターンと `optimizationLevel >= 2` による資源消費の問題で、修正版は11.0.1です。
上流3.8.2の指定はそれぞれ `^13.0.6` / `^10.2.6` で、通常更新では修正版に進めません。
確認した上流最新版3.8.2でも、この2つの指定は同じです。
2026-11-03に所有者が、この0.1.1候補と信頼できるビルド入力の用途に限り、4勧告の残存リスクを受容しました。
`scripts/dependency-risk.json` はバージョン・上流3.8.2・依存ロック・勧告本文を固定します。
`scripts/check-dependencies.mjs` は新しい指摘、High/Critical、ロックや勧告の変更を引き続き拒否します。
監査件数は0ではありません。任意のCMS本文・globパターン・ZIPを処理する用途への受容ではありません。
詳細は [glob の勧告](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4) と
[minimatch の勧告](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) を参照してください。

## 開発・検証

```sh
npm test
npx playwright install chromium
npm run test:consumer
OX_HONO_EXAMPLE=custom-host npm run test:consumer
```

テストは tarball を新しいアプリへインストールして型検査し、通常の build / dev / preview を実行します。
SSR、JavaScript 無効、CSS、props / slot / frontmatter、部品状態更新、各起動条件、破棄・キャンセル、
エラー時の SSR 保持、HMR（本文・CSS・部品・ルート追加削除）を確認します。
通常の Hono SSR build で import した MDX / Markdown が描画できることも確認します。
CI は Node 24 の1ジョブで両サンプルを検証する構成です。

## ライセンス

MIT。Ox Content 本体のコードを取り込まず、公開されている HTML host API を利用します。
