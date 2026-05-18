# Manual E2E test

## Phase 2: thread/start + turn/start で "What is 2+2?" を試す

### 前提

- `pnpm build` 済み
- `claude` CLI が認証されている (`~/.claude/` に OAuth トークン)

### 手順 1: initialize + thread/start だけを流す

```bash
cd apps/claude-app-server
cat examples/manual_test.jsonl | node dist/bin.js
```

レスポンスの `thr_<uuid>` をメモする。stderr にはサーバ側ログが流れる (stdout は JSON-RPC のみ)。

### 手順 2: thread/start のレスポンスを使って turn/start も流す

bash one-liner:

```bash
{
  echo '{"method":"initialize","id":0,"params":{"capabilities":{"experimentalApi":true},"clientInfo":{"name":"t","title":"t","version":"0.1.0"}}}'
  echo '{"method":"initialized","params":{}}'
  echo '{"method":"thread/start","id":1,"params":{}}'
  # thread/start のレスポンスから thr_<uuid> をコピーして以下を編集する
  echo '{"method":"turn/start","id":2,"params":{"threadId":"thr_REPLACE_ME","input":[{"type":"text","text":"What is 2+2?"}]}}'
  sleep 60  # SDK の応答を待つ
} | node dist/bin.js
```

または stdin を閉じるタイミングを制御したい場合は `timeout 60 node dist/bin.js` を使う。

### 期待出力

```
{"id":0,"result":{...}}                       // initialize
{"method":"thread/started",...}
{"id":1,"result":{"thread":{"id":"thr_..."}}} // thread/start
{"id":2,"result":{"turn":{"id":"turn_...","status":"inProgress",...}}}  // turn/start
{"method":"turn/started",...}
{"method":"item/started",...}                  // agentMessage
{"method":"item/agentMessage/delta",...}       // "4" を含むテキスト
{"method":"item/completed",...}
{"method":"turn/completed",...}                // status:completed
```
