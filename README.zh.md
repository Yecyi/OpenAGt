<p align="center">
  <a href="https://github.com/Yecyi/OpenAGt">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenAGt logo">
    </picture>
  </a>
</p>
<p align="center">寮€婧愮殑 AI Coding Agent銆?/p>
<p align="center">
  <a href="https://github.com/Yecyi/OpenAGt/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/openagt-ai"><img alt="npm" src="https://img.shields.io/npm/v/openagt-ai?style=flat-square" /></a>
  <a href="https://github.com/Yecyi/OpenAGt/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/openagt/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">绠€浣撲腑鏂?/a> |
  <a href="README.zht.md">绻侀珨涓枃</a> |
  <a href="README.ko.md">頃滉淡鞏?/a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Espa帽ol</a> |
  <a href="README.fr.md">Fran莽ais</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">鏃ユ湰瑾?/a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">袪褍褋褋泻懈泄</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">丕賱毓乇亘賷丞</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Portugu锚s (Brasil)</a> |
  <a href="README.th.md">喙勦笚喔?/a> |
  <a href="README.tr.md">T眉rk莽e</a> |
  <a href="README.uk.md">校泻褉邪褩薪褋褜泻邪</a> |
  <a href="README.bn.md">唳唳傕Σ唳?/a> |
  <a href="README.gr.md">螘位位畏谓喂魏维</a> |
  <a href="README.vi.md">Ti岷縩g Vi峄噒</a>
</p>

[![OpenAGt Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://github.com/Yecyi/OpenAGt)

---

## 鐩綍

- [瀹夎](#瀹夎)
- [妗岄潰搴旂敤绋嬪簭 (BETA)](#妗岄潰搴旂敤绋嬪簭-beta)
  - [瀹夎鐩綍](#瀹夎鐩綍)
- [Agents](#agents)
- [鏂囨。](#鏂囨。)
- [鍙備笌璐＄尞](#鍙備笌璐＄尞)
- [鍩轰簬 OpenAGt 杩涜寮€鍙慮(#鍩轰簬-openagt-杩涜寮€鍙?
- [甯歌闂 (FAQ)](#甯歌闂-faq)
  - [杩欏拰 Claude Code 鏈変粈涔堜笉鍚岋紵](#杩欏拰-claude-code-鏈変粈涔堜笉鍚?
- [OpenAGt 鎵╁睍](#openagt-鎵╁睍)
  - [涓昏澧炲己](#涓昏澧炲己)
  - [鏍稿績妯″潡鏂囨。](#鏍稿績妯″潡鏂囨。)

---

### 瀹夎

```bash
# 鐩存帴瀹夎 (YOLO)
curl -fsSL https://github.com/Yecyi/OpenAGt/install | bash

# 杞欢鍖呯鐞嗗櫒
npm i -g openagt-ai@latest        # 涔熷彲浣跨敤 bun/pnpm/yarn
scoop install openagt             # Windows
choco install openagt             # Windows
brew install anomalyco/tap/openagt # macOS 鍜?Linux锛堟帹鑽愶紝濮嬬粓淇濇寔鏈€鏂帮級
brew install openagt              # macOS 鍜?Linux锛堝畼鏂?brew formula锛屾洿鏂伴鐜囪緝浣庯級
sudo pacman -S openagt            # Arch Linux (Stable)
paru -S openagt-bin               # Arch Linux (Latest from AUR)
mise use -g openagt               # 浠绘剰绯荤粺
nix run nixpkgs#openagt           # 鎴栫敤 github:anomalyco/openagt 鑾峰彇鏈€鏂?dev 鍒嗘敮
```

> [!TIP]
> 瀹夎鍓嶈鍏堢Щ闄?0.1.x 涔嬪墠鐨勬棫鐗堟湰銆?

### 妗岄潰搴旂敤绋嬪簭 (BETA)

OpenAGt 涔熸彁渚涙闈㈢増搴旂敤銆傚彲鐩存帴浠?[鍙戝竷椤?(releases page)](https://github.com/Yecyi/OpenAGt/releases) 鎴?[github.com/Yecyi/OpenAGt/download](https://github.com/Yecyi/OpenAGt/download) 涓嬭浇銆?

| 骞冲彴                  | 涓嬭浇鏂囦欢                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `openagt-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `openagt-desktop-darwin-x64.dmg`     |
| Windows               | `openagt-desktop-windows-x64.exe`    |
| Linux                 | `.deb`銆乣.rpm` 鎴?AppImage            |

```bash
# macOS (Homebrew Cask)
brew install --cask openagt-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/openagt-desktop
```

#### 瀹夎鐩綍

瀹夎鑴氭湰鎸夌収浠ヤ笅浼樺厛绾у喅瀹氬畨瑁呰矾寰勶細

1. `$OPENCODE_INSTALL_DIR` - 鑷畾涔夊畨瑁呯洰褰?
2. `$XDG_BIN_DIR` - 绗﹀悎 XDG 鍩虹鐩綍瑙勮寖鐨勮矾寰?
3. `$HOME/bin` - 濡傛灉瀛樺湪鎴栧彲鍒涘缓鐨勭敤鎴蜂簩杩涘埗鐩綍
4. `$HOME/.openagt/bin` - 榛樿澶囩敤璺緞

```bash
# 绀轰緥
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://github.com/Yecyi/OpenAGt/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://github.com/Yecyi/OpenAGt/install | bash
```

### Agents

OpenAGt 鍐呯疆涓ょ Agent锛屽彲鐢?`Tab` 閿揩閫熷垏鎹細

- **build** - 榛樿妯″紡锛屽叿澶囧畬鏁存潈闄愶紝閫傚悎寮€鍙戝伐浣?
- **plan** - 鍙妯″紡锛岄€傚悎浠ｇ爜鍒嗘瀽涓庢帰绱?
  - 榛樿鎷掔粷淇敼鏂囦欢
  - 杩愯 bash 鍛戒护鍓嶄細璇㈤棶
  - 渚夸簬鎺㈢储鏈煡浠ｇ爜搴撴垨瑙勫垝鏀瑰姩

鍙﹀杩樺寘鍚竴涓?**general** 瀛?Agent锛岀敤浜庡鏉傛悳绱㈠拰澶氭浠诲姟锛屽唴閮ㄤ娇鐢紝涔熷彲鍦ㄦ秷鎭腑杈撳叆 `@general` 璋冪敤銆?

浜嗚В鏇村 [Agents](https://github.com/Yecyi/OpenAGt/docs/agents) 鐩稿叧淇℃伅銆?

### 鏂囨。

鏇村閰嶇疆璇存槑璇锋煡鐪嬫垜浠殑 [**瀹樻柟鏂囨。**](https://github.com/Yecyi/OpenAGt/docs)銆?

### 鍙備笌璐＄尞

濡傛湁鍏磋叮璐＄尞浠ｇ爜锛岃鍦ㄦ彁浜?PR 鍓嶉槄璇?[璐＄尞鎸囧崡 (Contributing Docs)](./CONTRIBUTING.md)銆?

### 鍩轰簬 OpenAGt 杩涜寮€鍙?

濡傛灉浣犲湪椤圭洰鍚嶄腑浣跨敤浜?"openagt"锛堝 "openagt-dashboard" 鎴?"openagt-mobile"锛夛紝璇峰湪 README 閲屾敞鏄庤椤圭洰涓嶆槸 OpenAGt 鍥㈤槦瀹樻柟寮€鍙戯紝涓斾笉瀛樺湪闅跺睘鍏崇郴銆?

### 甯歌闂 (FAQ)

#### 杩欏拰 Claude Code 鏈変粈涔堜笉鍚岋紵

鍔熻兘涓婂緢鐩镐技锛屽叧閿樊寮傦細

- 100% 寮€婧愩€?
- 涓嶇粦瀹氱壒瀹氭彁渚涘晢銆傛帹鑽愪娇鐢?[OpenAGt Zen](https://github.com/Yecyi/OpenAGt/zen) 鐨勬ā鍨嬶紝浣嗕篃鍙惌閰?Claude銆丱penAI銆丟oogle 鐢氳嚦鏈湴妯″瀷銆傛ā鍨嬭凯浠ｄ細缂╁皬宸紓銆侀檷浣庢垚鏈紝鍥犳淇濇寔 provider-agnostic 寰堥噸瑕併€?
- 鍐呯疆 LSP 鏀寔銆?
- 鑱氱劍缁堢鐣岄潰 (TUI)銆侽penCode 鐢?Neovim 鐖卞ソ鑰呭拰 [terminal.shop](https://terminal.shop) 鐨勫垱寤鸿€呮墦閫狅紝浼氭寔缁帰绱㈢粓绔殑鏋侀檺銆?
- 瀹㈡埛绔?鏈嶅姟鍣ㄦ灦鏋勩€傚彲鍦ㄦ湰鏈鸿繍琛岋紝鍚屾椂鐢ㄧЩ鍔ㄨ澶囪繙绋嬮┍鍔ㄣ€俆UI 鍙槸浼楀娼滃湪瀹㈡埛绔箣涓€銆?

---

## OpenAGt 鎵╁睍

OpenAGt 鏄熀浜?OpenAGt 鐨勫寮虹増鏈紝澧炲姞浜嗕互涓嬮珮绾у姛鑳姐€?

### 涓昏澧炲己

- **涓夊眰娓愯繘寮忓帇缂?* 鈥?涓婁笅鏂囩鐞嗭紝鍑忓皯 40-55% Token 浣跨敤
- **宸ュ叿骞跺彂鍒嗗尯** 鈥?骞惰鎵ц锛屽悶鍚愰噺鎻愬崌 2-3 鍊?
- **Provider 闄嶇骇閾?* 鈥?鑷姩鏁呴殰杞Щ
- **Prompt 娉ㄥ叆闃叉姢** 鈥?瀹夊叏鎵弿
- **Flutter 绉诲姩瀹㈡埛绔?* 鈥?杩滅▼鎺у埗锛堣鍒掍腑锛?

### 鏍稿績妯″潡鏂囨。

| 鏂囨。 | 鎻忚堪 |
|------|------|
| [README.md](./README.md) | 瀹屾暣鎶€鏈枃妗ｏ紙鑻辨枃锛?|
| [packages/openagt/README.md](./packages/openagt/README.md) | 鏍稿績寮曟搸 |
| [packages/openagt/src/effect/README.md](./packages/openagt/src/effect/README.md) | Effect Framework |
| [packages/openagt/src/acp/README.md](./packages/openagt/src/acp/README.md) | ACP 鍗忚 |
| [packages/openagt/src/sync/README.md](./packages/openagt/src/sync/README.md) | 浜嬩欢婧簮 |
| [packages/openagt/src/provider/README.md](./packages/openagt/src/provider/README.md) | LLM Provider |

---

**鍔犲叆鎴戜滑鐨勭ぞ鍖?* [椋炰功](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=738j8655-cd59-4633-a30a-1124e0096789&qr_code=true) | [X.com](https://x.com/openagt)
