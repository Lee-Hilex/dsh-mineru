window.__ModuleLoader__.load({
	id: "dsh-mineru",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");
		var { jsx, jsxs, Fragment } = require("react/jsx-runtime");
		var { useState, useEffect, useCallback, useRef } = React;

		// ------------------------------------------------------------------
		// Shared helpers
		// ------------------------------------------------------------------
		var S = {
			card: { background: "var(--dsw-alias-bg-layer-3, #16181d)", border: "1px solid var(--dsw-alias-border-l2, #2a2d34)", borderRadius: 8, padding: "16px 0" },
			field: { display: "flex", flexDirection: "column", gap: 6, padding: "10px 0", borderTop: "1px solid var(--dsw-alias-border-l2, #2a2d34)" },
			fieldHead: { display: "flex", alignItems: "center", gap: 8 },
			label: { flex: 1, fontSize: 13, fontWeight: 500, color: "var(--dsw-alias-label-primary, #e8e8e8)" },
			input: { background: "var(--dsw-alias-bg-layer-3, #16181d)", border: "1px solid var(--dsw-alias-border-l2, #2a2d34)", borderRadius: 8, height: 32, padding: "0 10px", fontSize: 13, color: "var(--dsw-alias-label-primary, #e8e8e8)" },
			hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, #8a8f98)" },
			badge: { whiteSpace: "nowrap", background: "var(--dsw-alias-bg-module-platform, #20242c)", color: "var(--dsw-alias-label-secondary, #a8adb8)", borderRadius: 999, padding: "1px 8px", fontSize: 11, lineHeight: "17px" },
			badgeOk: { whiteSpace: "nowrap", background: "rgba(64, 160, 90, 0.15)", color: "#5dbb76", borderRadius: 999, padding: "1px 8px", fontSize: 11, lineHeight: "17px" },
			badgeWarn: { whiteSpace: "nowrap", background: "rgba(214, 158, 46, 0.15)", color: "#d6a64b", borderRadius: 999, padding: "1px 8px", fontSize: 11, lineHeight: "17px" },
			button: { font: "inherit", cursor: "pointer", background: "var(--dsw-alias-bg-module-platform, #20242c)", color: "var(--dsw-alias-label-primary, #e8e8e8)", border: "1px solid var(--dsw-alias-border-l2, #2a2d34)", borderRadius: 8, padding: "6px 14px", fontSize: 12 },
			buttonPrimary: { font: "inherit", cursor: "pointer", background: "var(--dsw-alias-brand-primary, #4d6bfe)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 500 },
			row: { display: "flex", gap: 8, alignItems: "center" },
			error: { color: "var(--dsw-alias-label-error, #e5484d)", fontSize: 12, margin: 0 },
			okText: { color: "#5dbb76", fontSize: 12, margin: 0 },
			code: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12 },
			disclosure: { display: "flex", alignItems: "center", gap: 8, padding: "12px 0", cursor: "pointer", background: "none", border: "none", borderTop: "1px solid var(--dsw-alias-border-l2, #2a2d34)", font: "inherit", fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e8e8e8)", width: "100%", textAlign: "left" },
		};

		// ------------------------------------------------------------------
		// Form primitives
		// ------------------------------------------------------------------
		var MODES = ["auto", "precision", "agent"];
		var MODELS = ["pipeline", "vlm", "MinerU-HTML"];
		var LANGUAGES = ["ch", "ch_server", "en", "japan", "korean", "chinese_cht", "ta", "te", "ka", "el", "th", "latin", "arabic", "cyrillic", "east_slavic", "devanagari"];
		var EXTRA_FORMATS = ["docx", "html", "latex"];

		var MODE_LABELS = { auto: "自动 (有 Token 用精准解析, 否则用 Agent 轻量解析)", precision: "精准解析 API (需 Token)", agent: "Agent 轻量解析 API (免 Token)" };
		var MODEL_LABELS = { pipeline: "pipeline (基础)", vlm: "vlm (推荐)", "MinerU-HTML": "MinerU-HTML (HTML 专用)" };

		function apiLabel(api) {
			if (api === "precision") return "精准解析 API";
			if (api === "agent") return "Agent 轻量解析 API";
			if (api === "precision-missing-token") return "精准解析 (缺 Token)";
			return String(api ?? "");
		}

		function Field(props) {
			return jsxs("div", { style: S.field, children: [
				jsxs("div", { style: S.fieldHead, children: [
					jsx("label", { style: S.label, children: props.label }),
					props.badge ? jsx("span", { style: S.badge, children: props.badge }) : null,
				] }),
				props.children,
				props.hint ? jsx("p", { style: S.hint, children: props.hint }) : null,
			] });
		}

		function TextField(props) {
			return jsx(Field, { label: props.label, hint: props.hint, badge: props.badge, children: jsx("input", {
				type: "text", style: { ...S.input, width: "100%", boxSizing: "border-box" }, value: props.value ?? "",
				placeholder: props.placeholder, onChange: (e) => props.onChange(e.target.value),
			}) });
		}

		function NumberField(props) {
			return jsx(Field, { label: props.label, hint: props.hint, badge: props.badge, children: jsx("input", {
				type: "text", inputMode: "numeric", style: { ...S.input, width: "100%", boxSizing: "border-box" }, value: String(props.value ?? ""),
				onChange: (e) => props.onChange(e.target.value),
			}) });
		}

		function SelectField(props) {
			return jsx(Field, { label: props.label, hint: props.hint, badge: props.badge, children: jsx("select", {
				style: { ...S.input, width: "100%", boxSizing: "border-box", height: 34 }, value: String(props.value ?? ""),
				onChange: (e) => props.onChange(e.target.value),
				children: props.options.map((o) => jsx("option", { value: o.value, children: o.label }, o.value)),
			}) });
		}

		function CheckField(props) {
			return jsx("div", { style: { ...S.field, flexDirection: "row", alignItems: "center" }, children: [
				jsx("input", { type: "checkbox", checked: Boolean(props.value), style: { margin: 0 }, onChange: (e) => props.onChange(e.target.checked) }),
				jsx("label", { style: { ...S.label, cursor: "pointer" }, children: props.label }),
			] });
		}

		async function apiPost(path, body) {
			const res = await fetch("/plugin/mineru" + path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body ?? {}),
			});
			let payload = null;
			try { payload = await res.json(); } catch { /* non-JSON */ }
			return { status: res.status, payload };
		}

		// Minimal toast stack (top-center, auto dismiss), used by drop/paste uploads.
		var toastSeq = 0;
		function toast(text, kind) {
			var node = document.createElement("div");
			node.style.cssText = [
				"position: fixed", "top: 96px", "left: 50%", "transform: translateX(-50%)",
				"z-index: 99999", "max-width: 70vw", "padding: " + 10 + "px 16px",
				"border-radius: 8px", "font-size: 13px", "line-height: 1.5",
				"box-shadow: 0 8px 24px rgba(0,0,0,.4)",
				"transition: opacity .3s", "pointer-events: auto",
				"background: " + (kind === "error" ? "#4a1e20" : "#1f2c22"),
				"color: " + (kind === "error" ? "#ffb3b6" : "#a8e6b5"),
				"border: 1px solid " + (kind === "error" ? "#7a3035" : "#2f5c3a"),
			].join("; ");
			node.textContent = text;
			document.body.appendChild(node);
			toastSeq += 1;
			var mine = toastSeq;
			var stack = document.querySelectorAll("[data-mineru-toast]");
			node.setAttribute("data-mineru-toast", String(mine));
			node.style.top = (96 + stack.length * 52) + "px";
			setTimeout(function () {
				node.style.opacity = "0";
				setTimeout(function () { node.remove(); var rest = document.querySelectorAll("[data-mineru-toast]"); for (var i = 0; i < rest.length; i++) rest[i].style.top = (96 + i * 52) + "px"; }, 320);
			}, kind === "error" ? 6000 : 4200);
		}

		// ------------------------------------------------------------------
		// Settings tab: MinerU 解析
		// ------------------------------------------------------------------
		function MineruSettingsTab() {
			var [state, setState] = useState({ phase: "loading", revision: 0, value: {}, facts: null, defaults: {}, saveMsg: null, saveErr: null, testMsg: null, testErr: null });
			var [busy, setBusy] = useState({ save: false, reload: false, token: false, testToken: false, testAgent: false });
			var [showAdvanced, setShowAdvanced] = useState(false);
			var [tokenDraft, setTokenDraft] = useState("");
			var [dirty, setDirty] = useState(false);

			var reload = useCallback(async function (announce) {
				try {
					var res = await fetch("/plugin/mineru/config", { cache: "no-store" });
					var payload = await res.json();
					if (!res.ok || !payload.ok) throw new Error(payload.error ?? ("HTTP " + res.status));
					var value = payload.value ?? {};
					setState(function (prev) { return { ...prev, phase: "ready", revision: payload.revision ?? 0, value: value, facts: payload.facts ?? prev.facts, defaults: payload.schemaHints?.defaults ?? {}, saveMsg: announce === true ? "已重新加载." : null, saveErr: null }; });
					setDirty(false);
				} catch (err) {
					setState(function (prev) { return { ...prev, phase: "error", saveErr: "加载配置失败: " + (err?.message ?? String(err)) }; });
				}
			}, []);

			useEffect(function () { reload(); }, [reload]);

			var setValue = function (key, v) {
				setState(function (prev) { return { ...prev, value: { ...prev.value, [key]: v } }; });
				setDirty(true);
			};

			var save = async function () {
				if (busy.save) return;
				if (!dirty) {
					setState(function (prev) { return { ...prev, saveMsg: "没有需要保存的更改.", saveErr: null }; });
					return;
				}
				setBusy(function (b) { return { ...b, save: true }; });
				setState(function (prev) { return { ...prev, saveMsg: null, saveErr: null }; });
				try {
					var res = await apiPost("/config", { patch: state.value, expectedRevision: state.revision });
					if (res.status === 200 && res.payload?.ok) {
						setState(function (prev) { return { ...prev, revision: res.payload.revision ?? prev.revision, saveMsg: "已保存并生效." }; });
						setDirty(false);
						await reload();
					} else if (res.status === 409) {
						setState(function (prev) { return { ...prev, saveErr: "保存冲突: 设置已被其他会话修改, 请点击重新加载后再保存." }; });
					} else {
						setState(function (prev) { return { ...prev, saveErr: "保存失败: " + (res.payload?.error ?? ("HTTP " + res.status)) }; });
					}
				} catch (err) {
					setState(function (prev) { return { ...prev, saveErr: "保存失败 (网络错误): " + (err?.message ?? String(err)) }; });
				} finally {
					setBusy(function (b) { return { ...b, save: false }; });
				}
			};

			var saveToken = async function () {
				if (busy.token) return;
				setBusy(function (b) { return { ...b, token: true }; });
				setState(function (prev) { return { ...prev, saveMsg: null, saveErr: null }; });
				try {
					var res = await apiPost("/credential", { value: tokenDraft });
					if (res.status === 200 && res.payload?.ok) {
						setTokenDraft("");
						await reload();
						setState(function (prev) { return { ...prev, saveMsg: "Token 已保存 (当前解析通道: " + apiLabel(prev.facts?.api) + ")." }; });
					} else {
						setState(function (prev) { return { ...prev, saveErr: "保存 Token 失败: " + (res.payload?.error ?? ("HTTP " + res.status)) }; });
					}
				} catch (err) {
					setState(function (prev) { return { ...prev, saveErr: "保存 Token 失败 (网络错误): " + (err?.message ?? String(err)) }; });
				} finally {
					setBusy(function (b) { return { ...b, token: false }; });
				}
			};

			var clearToken = async function () {
				if (busy.token) return;
				setBusy(function (b) { return { ...b, token: true }; });
				setState(function (prev) { return { ...prev, saveMsg: null, saveErr: null }; });
				try {
					var res = await apiPost("/credential", { clear: true });
					if (res.status === 200 && res.payload?.ok) {
						setState(function (prev) { return { ...prev, saveMsg: "Token 已清除 (将使用 Agent 轻量解析 API)." }; });
						await reload();
					} else {
						setState(function (prev) { return { ...prev, saveErr: "清除 Token 失败: " + (res.payload?.error ?? ("HTTP " + res.status)) }; });
					}
				} catch (err) {
					setState(function (prev) { return { ...prev, saveErr: "清除 Token 失败 (网络错误): " + (err?.message ?? String(err)) }; });
				} finally {
					setBusy(function (b) { return { ...b, token: false }; });
				}
			};

			var runTest = async function (which) {
				var key = which === "token" ? "testToken" : "testAgent";
				if (busy[key]) return;
				setBusy(function (b) { return { ...b, [key]: true }; });
				setState(function (prev) { return { ...prev, testMsg: null, testErr: null }; });
				try {
					var res = await apiPost(which === "token" ? "/test-token" : "/test-agent", {});
					if (res.status === 200 && res.payload?.ok) {
						setState(function (prev) { return { ...prev, testMsg: res.payload.message ?? "测试通过." }; });
					} else {
						setState(function (prev) { return { ...prev, testErr: res.payload?.error ?? ("HTTP " + res.status) }; });
					}
				} catch (err) {
					setState(function (prev) { return { ...prev, testErr: "测试请求失败 (网络错误): " + (err?.message ?? String(err)) }; });
				} finally {
					setBusy(function (b) { return { ...b, [key]: false }; });
				}
			};

			if (state.phase === "loading") {
				return jsx("p", { style: S.hint, children: "正在加载 MinerU 配置…" });
			}
			if (state.phase === "error") {
				return jsxs("div", { children: [jsx("p", { style: S.error, children: state.saveErr }), jsx("button", { style: S.button, onClick: function () { setBusy(function (b) { return { ...b, reload: true }; }); reload(true).finally(function () { setBusy(function (b) { return { ...b, reload: false }; }); }); }, children: "重试" })] });
			}

			var facts = state.facts ?? {};
			var v = state.value;
			var anyBusy = busy.save || busy.reload || busy.token || busy.testToken || busy.testAgent;
			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [
				jsxs("div", { style: S.row, children: [
					jsx("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e8e8e8)" }, children: "MinerU 文档解析" }),
					facts.tokenConfigured ? jsx("span", { style: S.badgeOk, children: "Token 已配置" }) : jsx("span", { style: S.badgeWarn, children: "未配置 Token" }),
					jsx("span", { style: S.badge, children: "当前: " + apiLabel(facts.api) }),
				] }),
				jsx("p", { style: S.hint, children: "为 DeepSeek Harness 提供基于 MinerU 的多模态全格式文档解析 (PDF/Word/PPT/Excel/HTML/图片 → 结构化 Markdown). 填写 Token 走精准解析 API; Token 留空走 Agent 轻量解析 API. 也可以直接把文档/图片拖入聊天窗口, 插件会自动保存到工作区并发起解析." }),

				// ---- Token ----
				jsx(Field, { label: "MinerU Token (精准解析 API)", badge: facts.tokenConfigured ? "已配置 (" + (facts.tokenSource ?? "?") + ")" : "未配置", hint: "在 mineru.net 的 API 管理页面创建. 留空则自动使用 Agent 轻量解析 API (免登录, IP 限频). 值只写不读, 不落设置文件, 保存在 DSH 凭据中.", children: jsxs("div", { style: S.row, children: [
					jsx("input", { type: "password", style: { ...S.input, flex: 1 }, value: tokenDraft, placeholder: "留空 = 保留现有 Token", onChange: (e) => setTokenDraft(e.target.value) }),
					jsx("button", { style: S.buttonPrimary, disabled: busy.token || tokenDraft.length === 0, onClick: saveToken, children: busy.token ? "保存中…" : "保存密钥" }),
					jsx("button", { style: S.button, disabled: busy.token, onClick: clearToken, children: "清除" }),
				] }) }),

				// ---- Basic ----
				jsx(SelectField, { label: "API 模式", hint: "auto: 有 Token 用精准解析, 否则用 Agent 轻量解析.", badge: "mode", value: v.mode ?? "auto", options: MODES.map(function (m) { return { value: m, label: m + " — " + MODE_LABELS[m] }; }), onChange: (val) => setValue("mode", val) }),
				jsx(SelectField, { label: "精准解析模型版本", hint: "vlm 推荐; HTML 文件自动强制 MinerU-HTML.", value: v.modelVersion ?? "vlm", options: MODELS.map(function (m) { return { value: m, label: MODEL_LABELS[m] }; }), onChange: (val) => setValue("modelVersion", val) }),
				jsx(SelectField, { label: "文档语言", hint: "影响 OCR 识别效果, 默认 ch (中英).", value: v.language ?? "ch", options: LANGUAGES.map(function (l) { return { value: l, label: l }; }), onChange: (val) => setValue("language", val) }),
				jsx(CheckField, { label: "表格识别 (enableTable)", value: v.enableTable !== false, onChange: (val) => setValue("enableTable", val) }),
				jsx(CheckField, { label: "公式识别 (enableFormula)", value: v.enableFormula !== false, onChange: (val) => setValue("enableFormula", val) }),
				jsx(CheckField, { label: "强制 OCR (isOcr, 扫描件)", value: v.isOcr === true, onChange: (val) => setValue("isOcr", val) }),

				jsx(Field, { label: "额外导出格式 (精准解析)", hint: "Markdown + JSON 为默认输出; 可追加 docx/html/latex 到结果 Zip.", children: jsx("div", { style: S.row, children: EXTRA_FORMATS.map(function (f) {
					var on = Array.isArray(v.extraFormats) && v.extraFormats.indexOf(f) >= 0;
					return jsx("label", { style: { ...S.row, cursor: "pointer" }, children: [jsx("input", { type: "checkbox", checked: on, onChange: function (e) {
						var list = Array.isArray(v.extraFormats) ? v.extraFormats.slice() : [];
						if (e.target.checked) { if (list.indexOf(f) < 0) list.push(f); } else { list = list.filter(function (x) { return x !== f; }); }
						setValue("extraFormats", list);
					} }), jsx("span", { style: { fontSize: 13 }, children: f })] }, f);
				}) }) }),

				// ---- Advanced (collapsed) ----
				jsx("button", { type: "button", style: S.disclosure, onClick: function () { setShowAdvanced(!showAdvanced); }, children: (showAdvanced ? "▾ " : "▸ ") + "高级设置" + (dirty && !showAdvanced ? " (有未保存的更改)" : "") }),
				showAdvanced ? jsxs(Fragment, { children: [
					jsx(NumberField, { label: "整体超时 (ms)", hint: "含提交、上传、轮询等待与下载. 默认 600000 (10 分钟).", value: v.timeoutMs, onChange: (val) => setValue("timeoutMs", parseInt(val, 10)) }),
					jsx(NumberField, { label: "轮询间隔 (ms)", hint: "查询任务结果的间隔, 官方查询限频 1000 次/分钟.", value: v.pollIntervalMs, onChange: (val) => setValue("pollIntervalMs", parseInt(val, 10)) }),
					jsx(NumberField, { label: "本地文件大小上限 (字节)", hint: "0 = 按 API 限制 (精准 200MB / Agent 10MB).", value: v.maxFileBytes, onChange: (val) => setValue("maxFileBytes", parseInt(val, 10)) }),
					jsx(NumberField, { label: "结果内联预览上限 (字节)", hint: "工具结果内附的 Markdown 预览长度; 全文始终写入 Artifact.", value: v.inlineMarkdownBytes, onChange: (val) => setValue("inlineMarkdownBytes", parseInt(val, 10)) }),
					jsx(NumberField, { label: "提交限速 (个/分钟)", hint: "官方 50 个/分钟, 默认留 40 保有裕量.", value: v.submitRatePerMin, onChange: (val) => setValue("submitRatePerMin", parseInt(val, 10)) }),
					jsx(NumberField, { label: "查询限速 (次/分钟)", hint: "官方 1000 次/分钟, 默认 900.", value: v.pollRatePerMin, onChange: (val) => setValue("pollRatePerMin", parseInt(val, 10)) }),
					jsx(NumberField, { label: "每日提交上限 (个)", hint: "官方 5000 个/天 (html 100 个), 达到后在本地提前报错.", value: v.dailySubmitLimit, onChange: (val) => setValue("dailySubmitLimit", parseInt(val, 10)) }),
					jsx(NumberField, { label: "预览链接有效期 (秒)", hint: "Artifact 签名预览 URL 的过期时间.", value: v.artifactUrlTtlSec, onChange: (val) => setValue("artifactUrlTtlSec", parseInt(val, 10)) }),
					jsx(TextField, { label: "API 地址", hint: "默认 https://mineru.net.", value: v.apiBaseUrl, onChange: (val) => setValue("apiBaseUrl", val) }),
					jsx(TextField, { label: "凭据引用名", hint: "DSH Credential 引用名 (POSIX 标识符), 默认 MINERU_API_TOKEN.", value: v.tokenCredential, onChange: (val) => setValue("tokenCredential", val) }),
					jsx(TextField, { label: "Artifact 根目录名", hint: "每个工作区下的解析结果目录, 默认 .dsh-mineru.", value: v.artifactRootName, onChange: (val) => setValue("artifactRootName", val) }),
				] }) : null,

				// ---- Actions ----
				state.saveMsg ? jsx("p", { style: S.okText, children: state.saveMsg }) : null,
				state.saveErr ? jsx("p", { style: S.error, children: state.saveErr }) : null,
				jsxs("div", { style: { ...S.row, paddingTop: 12, flexWrap: "wrap" }, children: [
					jsx("button", { style: S.buttonPrimary, onClick: save, disabled: anyBusy, children: busy.save ? "保存中…" : (dirty ? "保存并应用" : "保存并应用 (无更改)") }),
					jsx("button", { style: S.button, disabled: anyBusy, onClick: function () { setBusy(function (b) { return { ...b, reload: true }; }); reload(true).finally(function () { setBusy(function (b) { return { ...b, reload: false }; }); }); }, children: busy.reload ? "加载中…" : "重新加载" }),
					jsx("span", { style: { flex: 1 } }),
					jsx("button", { style: S.button, disabled: anyBusy, onClick: function () { return runTest("agent"); }, children: busy.testAgent ? "测试中…(最多约3分钟)" : "测试 Agent API" }),
					jsx("button", { style: S.button, disabled: anyBusy, onClick: function () { return runTest("token"); }, children: busy.testToken ? "测试中…(最多约3分钟)" : "测试 Token" }),
				] }),
				state.testMsg ? jsx("p", { style: S.okText, children: state.testMsg }) : null,
				state.testErr ? jsx("p", { style: S.error, children: state.testErr }) : null,
			] });
		}

		// ------------------------------------------------------------------
		// Tool result cards for mineru_parse / mineru_batch_parse / mineru_task
		// ------------------------------------------------------------------
		function fmtBytes(n) {
			if (!Number.isFinite(n) || n <= 0) return "0 B";
			var units = ["B", "KB", "MB", "GB"];
			var i = 0, v = n;
			while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
			return (i === 0 ? String(v) : v.toFixed(1)) + " " + units[i];
		}

		function ArtifactChip(props) {
			var a = props.artifact;
			return jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, background: "var(--dsw-alias-bg-module-platform, #20242c)", border: "1px solid var(--dsw-alias-border-l2, #2a2d34)", borderRadius: 8, padding: "3px 10px", fontSize: 12 }, children: [
				jsx("button", { type: "button", title: a.path, style: { ...S.button, padding: "0", border: "none", background: "transparent", fontSize: 12 }, onClick: function () { props.openFile(a.path); }, children: a.name }),
				jsx("span", { style: S.hint, children: a.kind + " · " + fmtBytes(a.bytes) }),
				a.url ? jsx("a", { href: a.url, target: "_blank", rel: "noopener noreferrer", style: { fontSize: 12, color: "var(--dsw-alias-brand-primary, #4d6bfe)" }, children: "预览" }) : null,
			] }, a.path);
		}

		function MetaCard(props) {
			var meta = props.meta;
			if (!meta || typeof meta !== "object") return null;
			var artifacts = Array.isArray(meta.artifacts) ? meta.artifacts : [];
			var preview = meta.preview?.markdown;
			var header = [
				jsx("span", { key: "api", style: S.badge, children: apiLabel(meta.api) }),
				meta.modelVersion ? jsx("span", { key: "model", style: S.badge, children: String(meta.modelVersion) }) : null,
				meta.durationMs ? jsx("span", { key: "dur", style: S.badge, children: (meta.durationMs / 1000).toFixed(1) + "s" }) : null,
				meta.taskId ? jsx("span", { key: "task", style: { ...S.badge, fontFamily: "ui-monospace, Menlo, monospace" }, children: String(meta.taskId).slice(0, 12) }) : null,
			];
			if (meta.warning) header.push(jsx("span", { key: "warn", style: S.badgeWarn, children: String(meta.warning) }));
			var batchRows = null;
			if (Array.isArray(meta.results) && meta.results.length > 0) {
				batchRows = jsx("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: meta.results.map(function (r, i) {
					return jsxs("div", { key: i, style: S.row, children: [
						jsx("span", { style: r.state === "done" ? S.badgeOk : S.badgeWarn, children: r.state }),
						jsx("span", { style: { fontSize: 12 }, children: String(r.name ?? ("#" + i)) }),
						r.errMsg ? jsx("span", { style: S.error, children: String(r.errMsg).slice(0, 120) }) : null,
					] });
				}) });
			}
			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }, children: [
				jsx("div", { style: { ...S.row, flexWrap: "wrap" }, children: header }),
				batchRows,
				artifacts.length > 0 ? jsx("div", { style: { ...S.row, flexWrap: "wrap", gap: 6 }, children: artifacts.map(function (a, i) { return jsx(ArtifactChip, { key: i, artifact: a, openFile: props.openFile }); }) }) : null,
				preview ? jsx("pre", { style: { maxHeight: 240, overflow: "auto", margin: 0, padding: 10, background: "var(--dsw-alias-bg-layer-3, #16181d)", border: "1px solid var(--dsw-alias-border-l2, #2a2d34)", borderRadius: 8, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--dsw-alias-label-primary, #e8e8e8)" }, children: String(preview) }) : null,
			] });
		}

		function MineruToolView(props) {
			var block = props.block;
			if (!block) return null;
			var args = null;
			try {
				if (block.kind === "tool-result") args = block.call?.argsRaw ? JSON.parse(block.call.argsRaw) : null;
				else args = block.argsRaw ? JSON.parse(block.argsRaw) : null;
			} catch { /* args parse failure -> generic */ }

			if (block.kind === "tool-result") {
				var meta = block.meta;
				if (block.isError) {
					var text = "";
					if (Array.isArray(block.content)) {
						for (var i = 0; i < block.content.length; i++) {
							var b = block.content[i];
							if (b && b.type === "text") { text += b.text; break; }
						}
					}
					return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6, padding: "8px 0" }, children: [
						jsx("span", { style: S.badgeWarn, children: "解析失败" }),
						jsx("p", { style: S.error, children: String(text || "MinerU 任务失败").slice(0, 600) }),
					] });
				}
				return jsx(MetaCard, { meta: meta, openFile: props.openFile });
			}

			// running
			var source = args?.source ?? args?.taskId ?? "";
			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6, padding: "8px 0" }, children: [
				jsx("span", { style: S.badge, children: "MinerU 解析中…" }),
				jsx("p", { style: S.hint, children: "来源: " + String(source).slice(0, 200) }),
			] });
		}

		// ------------------------------------------------------------------
		// Drag-drop / paste bridge: files land in the session workspace and are
		// parsed via mineru_parse instead of the native image-attachment channel
		// (which text-only models reject at prompt admission).
		// ------------------------------------------------------------------
		var SUPPORTED_DROP_EXT = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg", ".jp2", ".webp", ".gif", ".bmp", ".html", ".htm"];
		var IMAGE_DROP_EXT = { ".png": 1, ".jpg": 1, ".jpeg": 1, ".jp2": 1, ".webp": 1, ".gif": 1, ".bmp": 1 };
		var DROP_MAX_BYTES = 210 * 1024 * 1024;

		function dropExtOf(name) {
			var i = String(name ?? "").lastIndexOf(".");
			return i < 0 ? "" : name.slice(i).toLowerCase();
		}

		function installFileDropBridge(ctx) {
			var { api } = ctx.get("connection");
			var currentSession = function () { return ctx.sessions.list.getSnapshot().current; };
			var hasFiles = function (event) { return event.dataTransfer ? event.dataTransfer.types.includes("Files") : false; };
			var supportedOf = function (list) {
				return Array.from(list ?? []).filter(function (f) { return f && SUPPORTED_DROP_EXT.includes(dropExtOf(f.name)); });
			};

			async function intake(files) {
				var sessionId = currentSession();
				if (!sessionId) {
					toast("请先打开一个会话, 再拖入文档.", "error");
					return;
				}
				var uploaded = [];
				for (var i = 0; i < files.length; i++) {
					var file = files[i];
					if (file.size === 0) { toast("跳过空文件: " + file.name, "error"); continue; }
					if (file.size > DROP_MAX_BYTES) { toast("文件超过 200MB 上限, 已跳过: " + file.name, "error"); continue; }
					try {
						var url = "/plugin/mineru/upload?sessionId=" + encodeURIComponent(sessionId) + "&name=" + encodeURIComponent(file.name);
						var res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
						var payload = null;
						try { payload = await res.json(); } catch { /* non-JSON */ }
						if (!res.ok || !payload?.ok) throw new Error(payload?.error ?? ("HTTP " + res.status));
						uploaded.push(payload.path);
					} catch (err) {
						toast("上传失败: " + file.name + " — " + (err?.message ?? String(err)), "error");
					}
				}
				if (uploaded.length === 0) return;
				var text = "我拖入了以下文件 (已保存到工作区):\n" + uploaded.map(function (p) { return "- " + p; }).join("\n")
					+ "\n\n请用 mineru_parse 逐个解析这些文件 (若 mineru_parse 不在你的工具列表中, 先调用一次 mineru_activate). 解析完成后请汇总关键内容.";
				try {
					var result = await api.sessions.prompt({ sessionId, mode: "queue", content: [{ type: "text", text }] });
					if (!result.result?.ok) {
						toast("解析请求发送失败: " + (result.result?.error?.message ?? "未知错误"), "error");
						return;
					}
					toast("已上传 " + uploaded.length + " 个文件并发送解析请求.");
				} catch (err) {
					toast("解析请求发送失败: " + (err?.message ?? String(err)), "error");
				}
			}

			var onDragEnter = function (event) {
				if (!hasFiles(event)) return;
				if (supportedOf(event.dataTransfer.files).length === 0) return;
				event.stopPropagation();
			};
			var onDragOver = function (event) {
				if (!hasFiles(event) || event.dataTransfer === null) return;
				if (supportedOf(event.dataTransfer.files).length === 0) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = "copy";
			};
			var onDrop = function (event) {
				if (!hasFiles(event)) return;
				var files = supportedOf(event.dataTransfer.files);
				if (files.length === 0) return;
				event.preventDefault();
				event.stopPropagation();
				intake(files);
			};
			var onPaste = function (event) {
				if (!event.clipboardData) return;
				var files = Array.from(event.clipboardData.items ?? [])
					.filter(function (it) { return it.kind === "file"; })
					.map(function (it) { return it.getAsFile(); })
					.filter(function (f) { return f !== null; })
					.filter(function (f) { return SUPPORTED_DROP_EXT.includes(dropExtOf(f.name)) && !IMAGE_DROP_EXT[dropExtOf(f.name)]; });
				if (files.length === 0) return;
				event.preventDefault();
				event.stopPropagation();
				intake(files);
			};

			document.addEventListener("dragenter", onDragEnter, true);
			document.addEventListener("dragover", onDragOver, true);
			document.addEventListener("drop", onDrop, true);
			document.addEventListener("paste", onPaste, true);
			return function () {
				document.removeEventListener("dragenter", onDragEnter, true);
				document.removeEventListener("dragover", onDragOver, true);
				document.removeEventListener("drop", onDrop, true);
				document.removeEventListener("paste", onPaste, true);
			};
		}

		// ------------------------------------------------------------------
		// Plugin entry
		// ------------------------------------------------------------------
		var inject = ["slots", "connection", "sessions"];

		function apply(ctx) {
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "mineru",
				order: 30,
				label: "MinerU 解析",
			}, MineruSettingsTab));

			ctx.slots.inject("tool.call.toolview", function* () {
				yield ctx.slots.register({ name: "tool.call.toolview", key: "mineru_parse" }, MineruToolView);
				yield ctx.slots.register({ name: "tool.call.toolview", key: "mineru_batch_parse" }, MineruToolView);
				yield ctx.slots.register({ name: "tool.call.toolview", key: "mineru_task" }, MineruToolView);
			});

			// File drop/paste bridge: document + image drops become workspace files
			// parsed through MinerU (no native image-attachment channel involved).
			ctx.effect(() => installFileDropBridge(ctx), "dsh-mineru: file drop bridge");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
