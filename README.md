# Yugo Puzzle — Web（個人用）

Steam版 [Yugo Puzzle](https://store.steampowered.com/app/1693260/Yugo_Puzzle/) を参考にした、スマホ向けブラウザ版です。**個人利用のみ**を想定しています。

## スマホ・ブラウザで遊ぶ（GitHub Pages）

**https://sz5674.github.io/game/**

iPhone / Android のブラウザで上記 URL を開き、ゼリーを **左右にスワイプ** して動かします（ホーム画面に追加しても遊べます）。

初回は次の **Pages 設定（1回だけ）** が必要です。

1. https://github.com/sz5674/game/settings/pages を開く  
2. **Build and deployment → Source** で **Deploy from a branch** を選ぶ  
3. **Branch: `gh-pages`**、フォルダ **`/ (root)`** → **Save**  
4. **Actions** タブで「Deploy to GitHub Pages」が成功するまで待つ（1〜3分）

まだ「There isn't a GitHub Pages site here」と出る場合は、上記 3 の Save 後に 5 分ほど待ってから URL を開き直してください。

## ローカルで遊ぶ

1. このフォルダでローカルサーバーを起動（`file://` では `levels.json` が読めません）:

   ```bash
   python -m http.server 8080
   ```

2. ブラウザで `http://localhost:8080` を開く（スマホなら同一 Wi‑Fi の PC の IP を指定）

3. ゼリーを **左右にスワイプ** して動かし、同色のブロックを合体させます

## レベルデータの再抽出

PCに Steam 版がインストールされている場合、原本と同じ40ステージ分の盤面を再生成できます。

```bash
pip install UnityPy
python tools/extract_levels.py
```

出力: `js/levels.json`（39ステージ + レベル38はデータ未取得時はプレースホルダ）

## ファイル構成

| パス | 内容 |
|------|------|
| `js/engine.js` | 移動・重力・合体・「跳ね上がり」後の横移動 |
| `js/app.js` | UI・進行保存・設定 |
| `js/levels.json` | 抽出した盤面データ |
| `tools/extract_levels.py` | Steam インストールからの抽出 |

## 注意

- 商用利用・再配布は想定していません
- 完全再現のため盤面はインストール済みゲームから抽出しています。ゲームをお持ちでない場合は `levels.json` を自分で用意できません
