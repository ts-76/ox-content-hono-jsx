# Ox Content Hono JSX adapter

Ox Content の HTML host API を Hono JSX に接続する独立パッケージです。
Markdown / MDX の変換・部品の検出・仮想モジュール・CSS の収集・HMR は Ox Content に任せ、
このパッケージは Hono JSX の SSR と `hono/jsx/dom` での部品起動・破棄を担当します。

現在は **0.1.0 のローカル実装候補**です。npm への公開はまだ行っていません。
Ox Content 3.4.0 / Hono 4.13.13 / Vite 8.3.4 を対象にしています。

## 動かす

このリポジトリでパッケージを準備し、サンプルを起動します。

```sh
npm ci --ignore-scripts --omit=peer
npm run build
cd examples/basic
npm install --ignore-scripts --omit=peer
npm run dev
```

アプリの通常操作は `npm run dev` / `npm run build` / `npm run preview` です。
アプリ側の手動 Markdown compile や生成ファイルの管理は不要です。
既存アプリへの導入には `npm pack` の tarball を使えます。

```sh
# パッケージ側
npm run build
npm pack
# アプリ側: 実際に生成された tarball のパスを指定
npm install /path/to/ts-76-ox-content-hono-jsx-0.1.0.tgz hono
npm install -D @ox-content/vite-plugin@3.4.0 vite@8.3.4
```

## 接続する

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
完成した例は [examples/basic/src/host.ts](examples/basic/src/host.ts) を参照してください。

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

| エントリー     | 役割                                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| パッケージ直下 | `FrontmatterContext` / `useFrontmatter()`                                     |
| `/server`      | `createHonoServerAdapter()`。Ox Content に渡す SSR callback                   |
| `/client`      | `createHonoHydrate()` / `initHonoIslands()`。起動と破棄                       |
| `/vite`        | `honoJsx()` / `createHonoRenderer()` / `renderHonoMarkdown()`。ビルド時の接続 |
| `/virtual`     | 仮想 module registry の型宣言                                                 |

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

## 開発・検証

```sh
npm test
npx playwright install chromium
npm run test:consumer
```

テストは tarball を新しいアプリへインストールして型検査し、通常の build / dev / preview を実行します。
SSR、JavaScript 無効、CSS、props / slot / frontmatter、部品状態更新、各起動条件、破棄・キャンセル、
エラー時の SSR 保持、HMR（本文・CSS・部品・ルート追加削除）を確認します。
CI は Node 24 の1ジョブで同じ検証を実行する構成です。

## ライセンス

MIT。Ox Content 本体のコードを取り込まず、公開されている HTML host API を利用します。
