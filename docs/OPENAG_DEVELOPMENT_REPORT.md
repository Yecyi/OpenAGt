<div align="center" style="width: 95%; max-width: 1400px; margin: 0 auto;"><font size="7">**OpenAGt 娣卞害鍒嗘瀽涓庡彂灞曞缓璁姤鍛?*</font></div>

**鍩轰簬 OpenAGt vs Codex vs Hermes Agent 瀵规瘮**

---

## 寮曡█

鏈姤鍛婃繁鍏ュ垎鏋?OpenAGt 涓庝笟鐣岄鍏堜骇鍝侊紙OpenAI Codex銆丷ust monorepo锛汬ermes Agent銆丳ython 绯荤粺锛夊湪鏋舵瀯銆佸姛鑳姐€佸伐绋嬭川閲忕瓑鏂归潰鐨勫樊璺濓紝骞舵彁鍑哄叿浣撱€佸彲琛岀殑鏀硅繘寤鸿銆?

**鍒嗘瀽鍓嶆彁**锛?

- OpenAGt 鏄竴涓湁娼滃姏鐨勫紑婧愰」鐩紝閲囩敤鐜颁唬鍖栫殑 Effect.ts 鏋舵瀯
- Codex 浠ｈ〃浼佷笟绾?AI 缂栫▼宸ュ叿鐨勬渶楂樻按骞?
- Hermes Agent 浠ｈ〃楂樺害鍙墿灞曠殑 AI Agent 绯荤粺

---

## 涓€銆丱penAGt 褰撳墠鐘舵€佽瘎浼?

### 1.1 鏋舵瀯浼樺娍锛堝凡鍏峰锛?

| 鐗规€?               | 鐜扮姸                       | 璇勪环                            |
| -------------------- | ---------------------------- | --------------------------------- |
| **Effect 妗嗘灦**    | 宸查噰鐢?Layer/Context 妯″紡 | 涓氱晫棰嗗厛鐨勪緷璧栨敞鍏ヤ綋楠? |
| **TypeScript**       | 瀹屾暣绫诲瀷瀹夊叏           | 寮€鍙戞晥鐜囬珮                   |
| **澶?Provider**      | 鏀寔 15+ AI 鎻愪緵鍟?       | 鏄捐憲浼樹簬绔炲搧                |
| \*_妯″潡鍖栬璁?_    | 377 鏂囦欢锛寏15 椤跺眰妯″潡 | 绠€娲佸彲缁存姢                   |
| \*_SQLite 鎸佷箙鍖?_ | Drizzle ORM + SQLite         | 缁撴瀯鍖栨暟鎹鐞?               |
| \*_鎶€鑳界郴缁?_     | `@openagt/skill` 宸ヤ綔鍖?   | 鍙墿灞曟妧鑳戒綋绯?              |

### 1.2 鏍稿績涓嶈冻锛堝緟鏀硅繘锛?

| 缁村害          | 褰撳墠鐘舵€?      | 宸窛璇勪及 |
| --------------- | ----------------- | ----------- |
| 瀹夊叏娌欑     | 鍩虹鏉冮檺绯荤粺 | 宸ㄥぇ宸窛 |
| 杩涚▼闅旂      | 鏃?               | 宸ㄥぇ宸窛 |
| 鍗忚皟鑰呮ā寮?  | 鏃?               | 鏄捐憲宸窛 |
| 澶?Agent 鍗忎綔 | 浠?subagent       | 鏄捐憲宸窛 |
| 浼佷笟绾ч儴缃?  | 鏃?daemon/杩滅▼   | 涓瓑宸窛  |
| 娴嬭瘯瑕嗙洊    | 鍩虹             | 涓瓑宸窛  |
| 鎻掍欢甯傚満    | 鍩虹             | 涓瓑宸窛  |

---

## 浜屻€佽缁嗗樊璺濆垎鏋?

### 2.1 瀹夊叏涓庢矙绠辨満鍒?

\**Codex 鐨勬矙绠卞灞傛灦鏋?*锛?

```
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹?                     User Space                             鈹?
鈹溾攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?  鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?  鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?     鈹?
鈹? 鈹?  Seatbelt  鈹?  鈹?  Landlock  鈹?  鈹?  Windows   鈹?     鈹?
鈹? 鈹? (macOS)    鈹?  鈹? (Linux)    鈹?  鈹俁estrictedToken鈹?     鈹?
鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹?  鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹?  鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹?     鈹?
鈹?        鈹?                 鈹?                  鈹?           鈹?
鈹溾攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹尖攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹尖攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹尖攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹?        鈻?                 鈻?                  鈻?           鈹?
鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?     鈹?
鈹? 鈹?             Exec Policy Layer                    鈹?     鈹?
鈹? 鈹? - Command whitelist                            鈹?     鈹?
鈹? 鈹? - Dangerous command detection                  鈹?     鈹?
鈹? 鈹? - Shell escalation control                    鈹?     鈹?
鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?     鈹?
鈹?                          鈹?                                鈹?
鈹溾攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹尖攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹?                          鈻?                                鈹?
鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?     鈹?
鈹? 鈹?             Keyring Store (瀹夊叏瀛樺偍)              鈹?     鈹?
鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?     鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
```

\**OpenAGt 鐨勫畨鍏ㄧ幇鐘?*锛?

```typescript
// 浠呭熀纭€鐨勬潈闄愯鍒欑郴缁?
const defaults = Permission.fromConfig({
  "*": "allow",
  doom_loop: "ask",
  external_directory: {
    "*": "ask",
    ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
  },
  question: "deny",
  plan_enter: "deny",
  plan_exit: "deny",
  read: {
    "*": "allow",
    "*.env": "ask",
    "*.env.*": "ask",
  },
})
```

**宸窛褰卞搷**锛?

- 鐢ㄦ埛鏃犳硶鍦ㄤ笉鍙椾俊浠荤殑鐜涓畨鍏ㄨ繍琛?OpenAGt
- 鏃犳硶浣滀负浼佷笟绾у伐鍏烽儴缃诧紙瀹夊叏鍥㈤槦涓嶄細鎵瑰噯锛?
- 鍗遍櫓鍛戒护娌℃湁澶氬眰闃叉姢

### 2.2 澶?Agent 鍗忚皟绯荤粺

**CC Source Code 鐨?Coordinator 妯″紡**锛?

```typescript
export function getCoordinatorSystemPrompt(): string {
  return `You are Claude Code, an AI assistant that orchestrates software engineering tasks across multiple workers.

## 1. Your Role

You are a **coordinator**. Your job is to:
- Help the user achieve their goal
- Direct workers to research, implement and verify code changes
- Synthesize results and communicate with the user
- Answer questions directly when possible 鈥?don't delegate work that you can handle without tools

## 2. Your Tools

- **AgentTool** - Spawn a new worker
- **SendMessageTool** - Continue an existing worker
- **TaskStopTool** - Stop a running worker

## 3. Workers

Workers execute tasks autonomously 鈥?especially research, implementation, or verification.
`
}
```

**OpenAGt 鐨?subagent 瀹炵幇**锛?

```typescript
// 浠呮敮鎸佸熀鏈殑 subagent锛屾病鏈夊崗璋冭€呮ā寮?
general: {
  name: "general",
  description: `General-purpose agent for researching complex questions and executing multi-step tasks.`,
  permission: Permission.merge(defaults, user),
  options: {},
  mode: "subagent",
}
```

**宸窛褰卞搷**锛?

- 鏃犳硶澶勭悊闇€瑕佸垎宸ュ崗浣滅殑澶嶆潅浠诲姟
- 鏃犳硶鍏呭垎鍒╃敤澶氭牳 CPU 骞惰澶勭悊
- 澶ц妯′唬鐮佸簱鍒嗘瀽鏁堢巼浣庝笅

### 2.3 娑堟伅浼犻€掍笌浜嬩欢绯荤粺

**Hermes Agent 鐨勬秷鎭€荤嚎**锛?

```python
# tools/registry.py - 涓ぎ娉ㄥ唽琛?
class ToolRegistry:
    def __init__(self):
        self._tools: Dict[str, ToolDef] = {}
        self._toolsets: Dict[str, Toolset] = {}

    def register(self, name, toolset, schema, handler, check_fn=None):
        """鎵€鏈夊伐鍏疯皟鐢ㄩ兘閫氳繃姝ゆ敞鍐岃〃"""
        self._tools[name] = ToolDef(...)

    def dispatch(self, tool_name, args, task_id=None):
        """缁熶竴鐨勫垎鍙戞満鍒?""
        return self._tools[tool_name].handler(args, task_id=task_id)
```

\**OpenAGt 鐨勫伐鍏峰垎鍙?*锛?

```typescript
// src/tool/executor.ts - 鐩稿绠€鍗?
export class ToolExecutor {
  async execute(tool: Tool, args: unknown): Promise<ToolResult> {
    // 鐩存帴鎵ц锛岀己灏戜腑闂村眰
  }
}
```

### 2.4 浼氳瘽鍘嬬缉涓庝笂涓嬫枃绠＄悊

**Hermes Agent 鐨勪笂涓嬫枃鍘嬬缉**锛?

```python
# agent/context_compressor.py
class ContextCompressor:
    def compress(self, messages: List[Message]) -> List[Message]:
        """鏅鸿兘涓婁笅鏂囧帇缂?""
        # 1. 璇嗗埆鍏抽敭鍐崇瓥鐐?
        # 2. 淇濈暀鏂囦欢鍙樻洿鍘嗗彶
        # 3. 鍘嬬缉鍐楅暱杈撳嚭
        # 4. 淇濇寔宸ュ叿璋冪敤鍥犳灉閾?
```

\**OpenAGt 鐨勫帇缂╃瓥鐣?*锛?

```typescript
// src/session/compaction/
export const compaction = z.discriminatedUnion("type", [compaction_full, compaction_micro, compaction_auto])
// 浠呬笁绉嶅浐瀹氭ā寮忥紝缂哄皯鏅鸿兘鍘嬬缉
```

### 2.5 閮ㄧ讲涓庤繍缁?

\**Codex 鐨勯儴缃叉灦鏋?*锛?

```
鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹?                    Codex CLI                               鈹?
鈹溾攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
鈹? Local Mode          鈹?   Remote Mode                      鈹?
鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹?   鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?   鈹?
鈹? 鈹? Local TUI    鈹? 鈹?   鈹? WebSocket Client          鈹?   鈹?
鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹? 鈹?   鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?   鈹?
鈹?         鈹?             鈹?                鈹?                  鈹?
鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈻尖攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?鈹?   鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈻尖攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?  鈹?
鈹? 鈹? exec-server    鈹?鈹?   鈹?  app-server (cloud)    鈹?  鈹?
鈹? 鈹? (闅旂杩涚▼)      鈹?鈹?   鈹?  (杩滅▼鎵ц)              鈹?  鈹?
鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?鈹?   鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?  鈹?
鈹?         鈹?             鈹?                鈹?                 鈹?
鈹? 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈻尖攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?鈹?   鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈻尖攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?  鈹?
鈹? 鈹? Sandbox         鈹?鈹?   鈹?  Sandbox (浜戠)          鈹?  鈹?
鈹? 鈹? (Landlock绛?   鈹?鈹?   鈹?                        鈹?  鈹?
鈹? 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?鈹?   鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?   鈹?
鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
```

\**OpenAGt 鐨勫綋鍓嶆灦鏋?*锛?

```typescript
// 鍗曚竴杩涚▼涓轰富锛岀己灏戣繙绋嬫墽琛岃兘鍔?
const AppLayer = Layer.mergeAll(
  Npm.defaultLayer,
  AppFileSystem.defaultLayer,
  Bus.defaultLayer,
  Auth.defaultLayer,
  // ... 鎵€鏈夋湇鍔￠兘鍦ㄥ悓涓€杩涚▼
)
```

---

## 涓夈€佸叿浣撴敼杩涘缓璁?

### 3.1 瀹夊叏娌欑绯荤粺锛堜紭鍏堢骇锛歅0 - 鏈€楂橈級

**鐩爣**锛氳揪鍒颁紒涓氱骇瀹夊叏鏍囧噯

\*_Phase 1锛氬熀纭€娌欑锛?-2涓湀锛?_

1. \*_鍗遍櫓鍛戒护妫€娴?_

```typescript
// src/security/dangerous-command-detector.ts
interface CommandRule {
  pattern: RegExp
  severity: "high" | "medium" | "low"
  message: string
}

const DANGEROUS_COMMANDS: CommandRule[] = [
  { pattern: /^rm\s+-rf\s+\//, severity: "high", message: "鏍圭洰褰曞垹闄? },
  { pattern: /^curl\s+.*\|.*sh/, severity: "high", message: "绠￠亾鎵ц杩滅▼鑴氭湰" },
  // ...
]
```

2. **澶栭儴鍛戒护鎵ц纭**

```typescript
// src/security/command-confirmation.ts
interface ConfirmationRequest {
  command: string
  reason: string
  preview?: string
}
```

\*_Phase 2锛氳繘绋嬮殧绂伙紙2-3涓湀锛?_

3. **Subprocess 娌欑**

```typescript
// src/sandbox/subprocess-sandbox.ts
interface SandboxConfig {
  maxMemory?: number
  maxCpu?: number
  maxTime?: number
  networkAccess?: "none" | "limited" | "full"
  filesystemScope?: string[]
}

async function runInSandbox(command: string, config: SandboxConfig): Promise<SandboxResult>
```

\*_Phase 3锛氶泦鎴?Landlock锛?-6涓湀锛?_

4. **Linux Landlock 闆嗘垚**锛堝弬鑰?Codex 鐨?`codex-shell-escalation` crate锛?

**棰勬湡鏀剁泭**锛?

- 浼佷笟瀹夊叏鍥㈤槦鍙壒鍑嗕娇鐢?
- 闃叉璇搷浣滃鑷寸殑鏁版嵁涓㈠け
- 鏀寔楂樺畨鍏ㄧ幆澧冮儴缃?

### 3.2 澶?Agent 鍗忚皟绯荤粺锛堜紭鍏堢骇锛歅1 - 楂橈級

**鐩爣**锛氭敮鎸佸鏉備换鍔＄殑鑷姩鍒嗚В涓庡苟琛屾墽琛?

**璁捐鑽夋**锛?

```typescript
// src/agent/coordinator.ts
interface Worker {
  id: string
  name: string
  status: "idle" | "busy" | "completed" | "failed"
  capabilities: string[]
  currentTask?: Task
}

interface CoordinatorService {
  readonly spawnWorker: (config: WorkerConfig) => Effect.Effect<Worker>
  readonly delegateTask: (workerId: string, task: Task) => Effect.Effect<TaskResult>
  readonly waitForWorkers: (pred: (workers: Worker[]) => boolean) => Effect.Effect<void>
  readonly synthesizeResults: (results: TaskResult[]) => Effect.Effect<string>
}

export class CoordinatorService extends Context.Service<CoordinatorService>()("@opencode/Coordinator") {
  // 瀹炵幇鍗忚皟鑰呴€昏緫
}
```

**鐢ㄦ埛鎺ュ彛**锛?

```yaml
# opencode.config.ts
agents:
  coordinator:
    name: "coordinator"
    description: "浠诲姟鍗忚皟鑰咃紝鑷姩鍒嗚В澶嶆潅浠诲姟"
    mode: "primary"
    tools: ["agent", "send-message", "task-stop"]
    workers:
      max-parallel: 4
      auto-scaling: true
```

**棰勬湡鏀剁泭**锛?

- 澶嶆潅浠诲姟澶勭悊鏁堢巼鎻愬崌 3-5x
- 鍏呭垎鍒╃敤澶氭牳 CPU
- 鐢ㄦ埛鍙渶鎻忚堪鐩爣锛岀郴缁熻嚜鍔ㄨ鍒掓墽琛?

### 3.3 鏅鸿兘涓婁笅鏂囧帇缂╋紙浼樺厛绾э細P1 - 楂橈級

**鐩爣**锛氬湪鏈夐檺涓婁笅鏂囩獥鍙ｅ唴鏈€澶у寲鏈夋晥淇℃伅

\*_Phase 1锛氬熀纭€鍘嬬缉澧炲己锛?-2涓湀锛?_

```typescript
// src/session/compaction/intelligent-compressor.ts
interface CompressionStrategy {
  preservePatterns: RegExp[]    # 蹇呴』淇濈暀鐨勬ā寮?
  summarizeBelow: number        # 瓒呰繃姝ら暱搴﹀垯鎽樿
  extractKeyDecisions: boolean  # 鎻愬彇鍏抽敭鍐崇瓥鐐?
}

const CODE_PRESERVATION = CompressionStrategy({
  preservePatterns: [
    /function\s+\w+/,        # 鍑芥暟绛惧悕
    /class\s+\w+/,           # 绫诲畾涔?
    /interface\s+\w+/,       # 鎺ュ彛瀹氫箟
    /import\s+.*from/,        # 瀵煎叆璇彞
    /export\s+/,             # 瀵煎嚭璇彞
  ],
  summarizeBelow: 500,
  extractKeyDecisions: true,
})
```

\*_Phase 2锛氳涔夊帇缂╋紙2-3涓湀锛?_

```typescript
// 鍩轰簬閲嶈鎬х殑鍘嬬缉
interface SemanticChunk {
  id: string
  importance: "critical" | "high" | "medium" | "low"
  content: string
  reason: string  # 涓轰粈涔堜繚鐣?鍘嬬缉
}

async function semanticallyCompress(
  messages: Message[],
  maxTokens: number
): Promise<CompressionResult>
```

**棰勬湡鏀剁泭**锛?

- 涓婁笅鏂囩獥鍙ｅ埄鐢ㄧ巼鎻愬崌 40%
- 闀夸細璇濊川閲忎繚鎸佺ǔ瀹?
- 闄嶄綆 token 鎴愭湰 30%

### 3.4 浼氳瘽 Fork 涓庡垎鏀紙浼樺厛绾э細P2 - 涓級

**鐩爣**锛氭敮鎸佸疄楠屾€т慨鏀圭殑瀹夊叏鎺㈢储

**鍙傝€?Hermes Agent 鐨?trajectory**锛?

```python
# hermes-agent/agent/trajectory.py
class TrajectorySaver:
    def save(self, agent_id, messages, tools_used, result):
        """淇濆瓨瀹屾暣杞ㄨ抗鐢ㄤ簬鍥炴斁鍜屽璁?""

    def replay(self, trajectory_id):
        """鍥炴斁鍘嗗彶杞ㄨ抗"""
```

**OpenAGt 璁捐鑽夋**锛?

```typescript
// src/session/trajectory.ts
interface Trajectory {
  id: string
  sessionId: string
  createdAt: number
  messages: Message[]
  toolCalls: ToolCall[]
  diffs: FileDiff[]
}

interface BranchService {
  readonly createBranch: (sessionId: SessionID, name: string) => Effect.Effect<Branch>
  readonly switchBranch: (branchId: BranchID) => Effect.Effect<void>
  readonly mergeBranch: (source: BranchID, target: BranchID) => Effect.Effect<MergeResult>
  readonly listBranches: (sessionId: SessionID) => Effect.Effect<Branch[]>
}
```

**棰勬湡鏀剁泭**锛?

- 瀹夊叏鎺㈢储瀹為獙鎬т慨鏀?
- 浠诲姟澶辫触鍚庡揩閫熷洖婊?
- 骞惰灏濊瘯澶氱瑙ｅ喅鏂规

### 3.5 杩滅▼鎵ц涓嶥aemon妯″紡锛堜紭鍏堢骇锛歅2 - 涓級

**鐩爣**锛氭敮鎸佽繙绋嬪紑鍙戝拰鍥㈤槦鍗忎綔

**鍙傝€?Codex 鐨?exec-server**锛?

```rust
// codex/exec-server/src/main.rs
pub struct ExecServerRuntimePaths {
    pub codex_exe: PathBuf,
    pub linux_sandbox_exe: PathBuf,
}

#[derive(Clone)]
pub struct ExecServer {
    paths: ExecServerRuntimePaths,
    transport: ServerTransport,
}
```

**OpenAGt 璁捐鑽夋**锛?

```typescript
// src/server/exec-server.ts
interface ExecServerConfig {
  host: string
  port: number
  authToken: string
  sandboxMode: "none" | "process" | "container"
}

interface RemoteSession {
  id: string
  userId: string
  projectId: string
  status: "active" | "paused" | "completed"
  transport: "websocket" | "stdio"
}

interface ExecServerService {
  readonly start: (config: ExecServerConfig) => Effect.Effect<void>
  readonly createSession: (projectId: string) => Effect.Effect<RemoteSession>
  readonly attachSession: (sessionId: string) => Effect.Effect<Session>
}
```

**棰勬湡鏀剁泭**锛?

- 鏀寔杩滅▼寮€鍙戝満鏅?
- 鍥㈤槦鍏变韩浼氳瘽涓婁笅鏂?
- 闄嶄綆鏈湴璧勬簮娑堣€?

### 3.6 鎻掍欢甯傚満涓庣敓鎬侊紙浼樺厛绾э細P2 - 涓級

**鐩爣**锛氭瀯寤哄彲鎸佺画鍙戝睍鐨勬彃浠剁敓鎬?

**鍙傝€?Hermes Agent 鐨?skills hub**锛?

```python
# hermes_cli/skills_hub.py
class SkillsHub:
    def search(self, query: str) -> List[Skill]:
        """鎼滅储鎶€鑳藉競鍦?""

    def install(self, skill_id: str) -> None:
        """瀹夎鎶€鑳藉埌鏈湴"""

    def publish(self, skill: Skill) -> None:
        """鍙戝竷鎶€鑳藉埌甯傚満"""
```

**OpenAGt 璁捐鑽夋**锛?

```typescript
// src/plugin/marketplace.ts
interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  license: string
  tools: ToolDefinition[]
  agents: AgentDefinition[]
  hooks: HookDefinition[]
}

interface MarketplaceService {
  readonly search: (query: string) => Effect.Effect<PluginManifest[]>
  readonly install: (pluginId: string) => Effect.Effect<void>
  readonly publish: (manifest: PluginManifest) => Effect.Effect<string>
  readonly update: (pluginId: string) => Effect.Effect<void>
}
```

**棰勬湡鏀剁泭**锛?

- 绀惧尯璐＄尞鐨勬彃浠剁敓鎬?
- 闄嶄綆鏍稿績寮€鍙戣礋鎷?
- 婊¤冻澶氭牱鍖栫敤鎴烽渶姹?

### 3.7 娴嬭瘯涓庤川閲忎繚闅滐紙浼樺厛绾э細P1 - 楂橈級

**鐩爣**锛氳揪鍒扮敓浜х骇璐ㄩ噺鏍囧噯

**褰撳墠闂**锛?

```
OpenAGt 鐨勬祴璇曠幇鐘讹細
- bun test --timeout 30000
- 娌℃湁娴嬭瘯瑕嗙洊鐜囪姹?
- 娌℃湁 CI 娴嬭瘯瑕嗙洊鐜?gate
```

**鏀硅繘璁″垝**锛?

```typescript
// 娴嬭瘯鍒嗗眰绛栫暐

// 1. 鍗曞厓娴嬭瘯 (Unit Tests)
describe("Permission.merge", () => {
  it("should merge two rulesets", () => {
    // ...
  })
})

// 2. 闆嗘垚娴嬭瘯 (Integration Tests)
describe("Session.fork", () => {
  it("should clone messages up to messageID", async () => {
    // 浣跨敤鐪熷疄鏁版嵁搴?
  })
})

// 3. 绔埌绔祴璇?(E2E Tests)
describe("CLI end-to-end", () => {
  it("should handle full conversation", async () => {
    // 妯℃嫙鐢ㄦ埛浜や簰
  })
})
```

**CI Pipeline 鏀硅繘**锛?

```yaml
# .github/workflows/test.yml
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - name: Run tests with coverage
        run: bun test --coverage --ci
      - name: Enforce coverage gate
        run: bun coverage-enforce --min 60%
```

**棰勬湡鏀剁泭**锛?

- 鍥炲綊缂洪櫡鍑忓皯 60%
- 閲嶆瀯淇″績鎻愬崌
- 鍙戝竷璐ㄩ噺绋冲畾

---

## 鍥涖€佽矾绾垮浘寤鸿

### 4.1 鐭湡锛?-3涓湀锛? 璐ㄩ噺绛戝熀

| 浠诲姟                       | 浼樺厛绾? | 棰勬湡鎴愭灉      |
| ---------------------------- | --------- | ----------------- |
| 鍗遍櫓鍛戒护妫€娴?           | P0        | 鍩虹瀹夊叏闃叉姢 |
| 娴嬭瘯瑕嗙洊鐜囨彁鍗囪嚦 60% | P1        | 璐ㄩ噺鍩虹嚎      |
| 鏅鸿兘鍘嬬缉 v1              | P1        | 闀夸細璇濇敮鎸?   |
| 鏂囨。瀹屽杽                 | P1        | 寮€鍙戣€呭弸濂?   |

### 4.2 涓湡锛?-6涓湀锛? 鑳藉姏鎵╁睍

| 浠诲姟             | 浼樺厛绾? | 棰勬湡鎴愭灉       |
| ------------------ | --------- | ------------------ |
| 澶?Agent 鍗忚皟鑰? | P1        | 澶嶆潅浠诲姟澶勭悊 |
| 杩涚▼娌欑         | P1        | 浼佷笟瀹夊叏鏍囧噯 |
| 浼氳瘽 Fork/Branch | P2        | 瀹為獙鎬ф帰绱?     |
| Landlock 闆嗘垚    | P2        | Linux 瀹夊叏       |

### 4.3 闀挎湡锛?-12涓湀锛? 鐢熸€佸缓璁?

| 浠诲姟                | 浼樺厛绾? | 棰勬湡鎴愭灉 |
| --------------------- | --------- | ------------ |
| 杩滅▼鎵ц Daemon      | P2        | 鍥㈤槦鍗忎綔 |
| 鎻掍欢甯傚満          | P2        | 鐢熸€佺郴缁? |
| 鎬ц兘浼樺寲           | P2        | 璧勬簮鏁堢巼 |
| 澶氬钩鍙版繁搴﹂泦鎴? | P3        | IDE 鏃犵紳   |

---

## 浜斻€佽祫婧愪及绠?

### 5.1 寮€鍙戝伐浣滈噺

| 鍔熻兘            | 鍒濈骇宸ョ▼甯? | 楂樼骇宸ョ▼甯? | 娴嬭瘯宸ョ▼甯? | 鎬讳汉鏈? |
| ----------------- | -------------- | -------------- | -------------- | --------- |
| 瀹夊叏娌欑绯荤粺 | 2              | 1              | 0.5            | 3.5       |
| 澶?Agent 鍗忚皟   | 2              | 2              | 1              | 5         |
| 鏅鸿兘鍘嬬缉      | 1              | 1.5            | 0.5            | 3         |
| 娴嬭瘯浣撶郴      | 1              | 0.5            | 2              | 3.5       |
| 杩滅▼鎵ц         | 2              | 2              | 1              | 5         |
| **鎬昏**         | **8**          | **7**          | **5**          | **20**    |

### 5.2 鎶€鏈闄?

| 椋庨櫓                 | 褰卞搷 | 缂撹В绛栫暐                         |
| ---------------------- | ------ | ----------------------------------- |
| Effect 妗嗘灦灞€闄愭€? | 楂?    | 鑰冭檻鍏抽敭璺緞浣跨敤鍘熺敓瀹炵幇 |
| Rust 娌欑瀛︿範鏇茬嚎 | 涓?    | 鍙傝€?Codex 寮€婧愬疄鐜?            |
| 鍘嬬缉绠楁硶璐ㄩ噺     | 涓?    | 鐢ㄦ埛鍙嶉椹卞姩杩唬              |

---

## 鍏€佺珵浜変紭鍔垮垎鏋?

### 6.1 OpenAGt 鐨勭嫭鐗逛紭鍔?

| 浼樺娍            | 璇存槑                 | 绔炲搧宸窛          |
| ----------------- | ---------------------- | -------------------- |
| **澶?Provider**   | 15+ AI 鎻愪緵鍟嗘敮鎸? | Codex 浠?OpenAI      |
| **Effect 鏋舵瀯** | 鐜颁唬渚濊禆娉ㄥ叆     | Hermes 鐢?Python 绫? |
| \*_Bun 杩愯鏃?_  | 蹇€熷惎鍔?            | Hermes Python 杈冩參 |
| **TypeScript**    | 瀹屾暣绫诲瀷瀹夊叏     | Hermes 绫诲瀷寮?     |

### 6.2 宸紓鍖栨柟鍚戝缓璁?

1. \**澶氭ā鍨嬫櫤鑳借矾鐢?*锛氭牴鎹换鍔＄被鍨嬭嚜鍔ㄩ€夋嫨鏈€浼樻ā鍨?
2. **鏈湴浼樺厛**锛氬己璋冮殣绉佸拰绂荤嚎鑳藉姏
3. \**寮€鏀剧敓鎬?*锛氬畬鍏ㄥ紑婧愶紝绀惧尯椹卞姩

---

## 涓冦€佹€荤粨

### 7.1 鏍稿績鍙戠幇

1. \**瀹夊叏鏄渶澶х煭鏉?*锛氱己灏戞矙绠辨満鍒舵槸浼佷笟绾ч儴缃茬殑鏈€澶ч殰纰?
2. \**澶?Agent 鏄兘鍔涘叧閿?*锛氬鏉備换鍔″鐞嗛渶瑕佸崗璋冭€呮ā寮?
3. **涓婁笅鏂囩鐞嗘湁鍩虹**锛氫絾鏅鸿兘鍘嬬缉杩樻湁寰堝ぇ鎻愬崌绌洪棿
4. \**娴嬭瘯瑕嗙洊鐜囦笉瓒?*锛氬奖鍝嶈凯浠ｄ俊蹇?

### 7.2 浼樺厛琛屽姩椤?

\**绔嬪嵆寮€濮嬶紙鏈湀锛?*锛?

1. 瀹炵幇鍗遍櫓鍛戒护妫€娴?
2. 寤虹珛娴嬭瘯瑕嗙洊鐜?gate

\**涓嬪搴︾洰鏍?*锛?

1. 瀹屾垚澶?Agent 鍗忚皟鑰?
2. 瀹炵幇杩涚▼娌欑

**骞村害鎰挎櫙**锛?

1. 浼佷笟绾у畨鍏ㄦ爣鍑嗚揪鎴?
2. 娲昏穬鐨勬彃浠剁敓鎬佺郴缁?

---

## 闄勫綍锛氱浉鍏宠祫婧?

- [OpenAGt GitHub](https://github.com/anomalyco/opencode)
- [Codex CLI (Rust monorepo)](https://github.com/openai/codex)
- [Hermes Agent](https://github.com/cosmos-44/hermes-agent)
- [Effect.ts 妗嗘灦](https://effect.website/)

---

_鎶ュ憡鐢熸垚鏃堕棿锛?026-04-19_
_鍩轰簬锛歄penAGt v1.14.17銆丆odex (Rust monorepo)銆丠ermes Agent (Python)_
