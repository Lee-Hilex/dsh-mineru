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
		// i18n: zh/en dictionaries registered with ctx.locale. When the locale
		// service is unavailable (older host), the zh dict is the fallback.
		// ------------------------------------------------------------------
		var NS = "dsh-mineru";
		var DICTS = {
			zh: {
				"toast.noSession": "请先打开一个会话, 再拖入文档.",
				"toast.emptyFile": "跳过空文件: {name}",
				"toast.tooLarge": "文件超过 200MB 上限, 已跳过: {name}",
				"toast.uploadFail": "上传失败: {name} — {err}",
				"toast.uploadedN": "已上传 {n} 个文件并填入输入框: 请补充需求后点击发送.",
				"toast.draftFail": "文件已上传, 但写入输入框失败: {err} 文件路径: {paths}",
				"drop.draftText": "我拖入了以下文件 (已保存到工作区):\n",
				"settings.loading": "正在加载 MinerU 配置…",
				"settings.retry": "重试",
				"settings.loadFail": "加载配置失败: {err}",
				"settings.title": "MinerU 文档解析",
				"badge.tokenOk": "Token 已配置",
				"badge.tokenMissing": "未配置 Token",
				"badge.current": "当前: {api}",
				"settings.intro": "为 DeepSeek Harness 提供基于 MinerU 的多模态全格式文档解析 (PDF/Word/PPT/Excel/HTML/图片 → 结构化 Markdown). 填写 Token 走精准解析 API; Token 留空走 Agent 轻量解析 API. 也可以直接把文档/图片拖入聊天窗口, 插件会自动保存到工作区并发起解析.",
				"field.token.label": "MinerU Token (精准解析 API)",
				"field.token.badgeConfigured": "已配置 ({src})",
				"field.token.badgeMissing": "未配置",
				"field.token.hint": "在 mineru.net 的 API 管理页面创建. 留空则自动使用 Agent 轻量解析 API (免登录, IP 限频). 值只写不读, 不落设置文件, 保存在 DSH 凭据中.",
				"field.token.placeholder": "留空 = 保留现有 Token",
				"action.saveToken": "保存密钥",
				"action.saving": "保存中…",
				"action.clear": "清除",
				"field.mode.label": "API 模式",
				"field.mode.hint": "auto: 有 Token 用精准解析, 否则用 Agent 轻量解析.",
				"mode.auto": "自动 (有 Token 用精准解析, 否则用 Agent 轻量解析)",
				"mode.precision": "精准解析 API (需 Token)",
				"mode.agent": "Agent 轻量解析 API (免 Token)",
				"field.model.label": "精准解析模型版本",
				"field.model.hint": "vlm 推荐; HTML 文件自动强制 MinerU-HTML.",
				"model.pipeline": "pipeline (基础)",
				"model.vlm": "vlm (推荐)",
				"model.mineruHtml": "MinerU-HTML (HTML 专用)",
				"field.lang.label": "文档语言",
				"field.lang.hint": "影响 OCR 识别效果, 默认 ch (中英).",
				"field.table.label": "表格识别 (enableTable)",
				"field.formula.label": "公式识别 (enableFormula)",
				"field.ocr.label": "强制 OCR (isOcr, 扫描件)",
				"field.extra.label": "额外导出格式 (精准解析)",
				"field.extra.hint": "Markdown + JSON 为默认输出; 可追加 docx/html/latex 到结果 Zip.",
				"disclosure.advanced": "高级设置",
				"disclosure.dirty": " (有未保存的更改)",
				"adv.timeout.label": "整体超时 (ms)",
				"adv.timeout.hint": "含提交、上传、轮询等待与下载. 默认 600000 (10 分钟).",
				"adv.pollInterval.label": "轮询间隔 (ms)",
				"adv.pollInterval.hint": "查询任务结果的间隔, 官方查询限频 1000 次/分钟.",
				"adv.maxFileBytes.label": "本地文件大小上限 (字节)",
				"adv.maxFileBytes.hint": "0 = 按 API 限制 (精准 200MB / Agent 10MB).",
				"adv.inlineMarkdownBytes.label": "结果内联预览上限 (字节)",
				"adv.inlineMarkdownBytes.hint": "工具结果内附的 Markdown 预览长度; 全文始终写入 Artifact.",
				"adv.submitRate.label": "提交限速 (个/分钟)",
				"adv.submitRate.hint": "官方 50 个/分钟, 默认留 40 保有裕量.",
				"adv.pollRate.label": "查询限速 (次/分钟)",
				"adv.pollRate.hint": "官方 1000 次/分钟, 默认 900.",
				"adv.dailyLimit.label": "每日提交上限 (个)",
				"adv.dailyLimit.hint": "官方 5000 个/天 (html 100 个), 达到后在本地提前报错.",
				"adv.urlTtl.label": "预览链接有效期 (秒)",
				"adv.urlTtl.hint": "Artifact 签名预览 URL 的过期时间.",
				"adv.apiBase.label": "API 地址",
				"adv.apiBase.hint": "默认 https://mineru.net.",
				"adv.tokenCredential.label": "凭据引用名",
				"adv.tokenCredential.hint": "DSH Credential 引用名 (POSIX 标识符), 默认 MINERU_API_TOKEN.",
				"adv.artifactRoot.label": "Artifact 根目录名",
				"adv.artifactRoot.hint": "每个工作区下的解析结果目录, 默认 .dsh-mineru.",
				"action.save": "保存并应用",
				"action.saveNoop": "保存并应用 (无更改)",
				"action.reload": "重新加载",
				"action.loading": "加载中…",
				"action.testAgent": "测试 Agent API",
				"action.testToken": "测试 Token",
				"action.testingLong": "测试中…(最多约3分钟)",
				"msg.saved": "已保存并生效.",
				"msg.noop": "没有需要保存的更改.",
				"msg.reloaded": "已重新加载.",
				"msg.conflict": "保存冲突: 设置已被其他会话修改, 请点击重新加载后再保存.",
				"msg.saveFail": "保存失败: {err}",
				"msg.saveNetFail": "保存失败 (网络错误): {err}",
				"msg.tokenSaved": "Token 已保存 (当前解析通道: {api}).",
				"msg.tokenCleared": "Token 已清除 (将使用 Agent 轻量解析 API).",
				"msg.tokenSaveFail": "保存 Token 失败: {err}",
				"msg.tokenSaveNetFail": "保存 Token 失败 (网络错误): {err}",
				"msg.tokenClearFail": "清除 Token 失败: {err}",
				"msg.tokenClearNetFail": "清除 Token 失败 (网络错误): {err}",
				"msg.testNetFail": "测试请求失败 (网络错误): {err}",
				"err.composer": "输入框服务不可用",
				"msg.testOk": "测试通过.",
				"api.precision": "精准解析 API",
				"api.agent": "Agent 轻量解析 API",
				"api.precisionMissingToken": "精准解析 (缺 Token)",
				"view.failed": "解析失败",
				"view.taskFailed": "MinerU 任务失败",
				"view.parsing": "MinerU 解析中…",
				"view.source": "来源: {src}",
				"chip.preview": "预览",
			},
			en: {
				"toast.noSession": "Open a session first, then drop documents.",
				"toast.emptyFile": "Skipped empty file: {name}",
				"toast.tooLarge": "File exceeds the 200MB limit, skipped: {name}",
				"toast.uploadFail": "Upload failed: {name} — {err}",
				"toast.uploadedN": "Uploaded {n} file(s) and filled the input box: add your request, then send.",
				"toast.draftFail": "Files uploaded, but filling the input box failed: {err}. Paths: {paths}",
				"drop.draftText": "I dropped the following files (saved to the workspace):\n",
				"settings.loading": "Loading MinerU settings…",
				"settings.retry": "Retry",
				"settings.loadFail": "Failed to load settings: {err}",
				"settings.title": "MinerU Document Parsing",
				"badge.tokenOk": "Token configured",
				"badge.tokenMissing": "No token",
				"badge.current": "Current: {api}",
				"settings.intro": "Provides DeepSeek Harness with MinerU-based multimodal document parsing (PDF/Word/PPT/Excel/HTML/images → structured Markdown). Configure a token to use the precision API, or leave it empty for the token-free Agent lightweight API. You can also drop documents/images into the chat: the plugin saves them to the workspace and starts parsing.",
				"field.token.label": "MinerU Token (precision API)",
				"field.token.badgeConfigured": "Configured ({src})",
				"field.token.badgeMissing": "Not configured",
				"field.token.hint": "Create one in the API management page on mineru.net. Leave empty to use the Agent lightweight API (no login, IP rate-limited). Write-only: the value is stored in DSH Credentials, never in settings files.",
				"field.token.placeholder": "Leave empty = keep the current token",
				"action.saveToken": "Save token",
				"action.saving": "Saving…",
				"action.clear": "Clear",
				"field.mode.label": "API mode",
				"field.mode.hint": "auto: precision API when a token is configured, otherwise the Agent lightweight API.",
				"mode.auto": "Auto (precision API when a token is set, otherwise Agent lightweight API)",
				"mode.precision": "Precision API (requires token)",
				"mode.agent": "Agent lightweight API (no token)",
				"field.model.label": "Precision model version",
				"field.model.hint": "vlm is recommended; HTML files are force-pinned to MinerU-HTML.",
				"model.pipeline": "pipeline (basic)",
				"model.vlm": "vlm (recommended)",
				"model.mineruHtml": "MinerU-HTML (HTML only)",
				"field.lang.label": "Document language",
				"field.lang.hint": "Affects OCR quality; default ch (Chinese + English).",
				"field.table.label": "Table recognition (enableTable)",
				"field.formula.label": "Formula recognition (enableFormula)",
				"field.ocr.label": "Force OCR (isOcr, scanned documents)",
				"field.extra.label": "Extra export formats (precision)",
				"field.extra.hint": "Markdown + JSON are always exported; add docx/html/latex to the result Zip.",
				"disclosure.advanced": "Advanced settings",
				"disclosure.dirty": " (unsaved changes)",
				"adv.timeout.label": "Overall timeout (ms)",
				"adv.timeout.hint": "Covers submission, upload, polling and download. Default 600000 (10 min).",
				"adv.pollInterval.label": "Poll interval (ms)",
				"adv.pollInterval.hint": "Interval between task-status queries; the official query limit is 1000/min.",
				"adv.maxFileBytes.label": "Local file size limit (bytes)",
				"adv.maxFileBytes.hint": "0 = follow API limits (precision 200MB / Agent 10MB).",
				"adv.inlineMarkdownBytes.label": "Inline preview limit (bytes)",
				"adv.inlineMarkdownBytes.hint": "Length of the Markdown preview attached to tool results; the full text always goes to the Artifact.",
				"adv.submitRate.label": "Submission rate (per minute)",
				"adv.submitRate.hint": "Official limit is 50/min; the default of 40 leaves headroom.",
				"adv.pollRate.label": "Query rate (per minute)",
				"adv.pollRate.hint": "Official limit is 1000/min; default 900.",
				"adv.dailyLimit.label": "Daily submission limit",
				"adv.dailyLimit.hint": "Official limit is 5000/day (100 HTML); the plugin fails fast locally once reached.",
				"adv.urlTtl.label": "Preview link TTL (seconds)",
				"adv.urlTtl.hint": "Expiry of signed artifact preview URLs.",
				"adv.apiBase.label": "API base URL",
				"adv.apiBase.hint": "Default https://mineru.net.",
				"adv.tokenCredential.label": "Credential reference name",
				"adv.tokenCredential.hint": "DSH Credential reference (POSIX identifier), default MINERU_API_TOKEN.",
				"adv.artifactRoot.label": "Artifact root name",
				"adv.artifactRoot.hint": "Parsing-results directory under each workspace, default .dsh-mineru.",
				"action.save": "Save & apply",
				"action.saveNoop": "Save & apply (no changes)",
				"action.reload": "Reload",
				"action.loading": "Loading…",
				"action.testAgent": "Test Agent API",
				"action.testToken": "Test token",
				"action.testingLong": "Testing… (up to ~3 min)",
				"msg.saved": "Saved and applied.",
				"msg.noop": "No changes to save.",
				"msg.reloaded": "Reloaded.",
				"msg.conflict": "Save conflict: settings were changed elsewhere; click Reload before saving again.",
				"msg.saveFail": "Save failed: {err}",
				"msg.saveNetFail": "Save failed (network error): {err}",
				"msg.tokenSaved": "Token saved (current channel: {api}).",
				"msg.tokenCleared": "Token cleared (the Agent lightweight API will be used).",
				"msg.tokenSaveFail": "Failed to save token: {err}",
				"msg.tokenSaveNetFail": "Failed to save token (network error): {err}",
				"msg.tokenClearFail": "Failed to clear token: {err}",
				"msg.tokenClearNetFail": "Failed to clear token (network error): {err}",
				"msg.testNetFail": "Test request failed (network error): {err}",
				"err.composer": "Composer input service unavailable",
				"msg.testOk": "Test passed.",
				"api.precision": "precision API",
				"api.agent": "Agent lightweight API",
				"api.precisionMissingToken": "precision (missing token)",
				"view.failed": "Parsing failed",
				"view.taskFailed": "MinerU task failed",
				"view.parsing": "MinerU parsing…",
				"view.source": "Source: {src}",
				"chip.preview": "Preview",
			},
		};
		var currentT = function (key) { return DICTS.zh[key] !== undefined ? DICTS.zh[key] : key; };
		function fmtT(str, vars) {
			return String(str).replace(/\{(\w+)\}/g, function (_, k) { return vars && vars[k] !== undefined ? vars[k] : "{" + k + "}"; });
		}
		function T(key, vars) { return fmtT(currentT(key), vars); }
		var localeVersion = 0;
		var localeSubs = [];
		function useLocaleVersion() {
			var [v, setV] = useState(localeVersion);
			useEffect(function () {
				var fn = function () { setV(localeVersion); };
				localeSubs.push(fn);
				return function () { localeSubs = localeSubs.filter(function (f) { return f !== fn; }); };
			}, []);
			return v;
		}

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
			buttonPrimary: { font: "inherit", cursor: "pointer", background: "var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4d6bfe)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 500 },
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

		function modeLabel(m) { return T("mode." + m); }
		function modelLabel(m) { return m === "MinerU-HTML" ? T("model.mineruHtml") : T("model." + m); }

		function apiLabel(api) {
			if (api === "precision") return T("api.precision");
			if (api === "agent") return T("api.agent");
			if (api === "precision-missing-token") return T("api.precisionMissingToken");
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
			useLocaleVersion();
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
					setState(function (prev) { return { ...prev, phase: "ready", revision: payload.revision ?? 0, value: value, facts: payload.facts ?? prev.facts, defaults: payload.schemaHints?.defaults ?? {}, saveMsg: announce === true ? T("msg.reloaded") : null, saveErr: null }; });
					setDirty(false);
				} catch (err) {
					setState(function (prev) { return { ...prev, phase: "error", saveErr: T("settings.loadFail", { err: err?.message ?? String(err) }) }; });
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
					setState(function (prev) { return { ...prev, saveMsg: T("msg.noop"), saveErr: null }; });
					return;
				}
				setBusy(function (b) { return { ...b, save: true }; });
				setState(function (prev) { return { ...prev, saveMsg: null, saveErr: null }; });
				try {
					var res = await apiPost("/config", { patch: state.value, expectedRevision: state.revision });
					if (res.status === 200 && res.payload?.ok) {
						setState(function (prev) { return { ...prev, revision: res.payload.revision ?? prev.revision, saveMsg: T("msg.saved") }; });
						setDirty(false);
						await reload();
					} else if (res.status === 409) {
						setState(function (prev) { return { ...prev, saveErr: T("msg.conflict") }; });
					} else {
						setState(function (prev) { return { ...prev, saveErr: T("msg.saveFail", { err: res.payload?.error ?? ("HTTP " + res.status) }) }; });
					}
				} catch (err) {
					setState(function (prev) { return { ...prev, saveErr: T("msg.saveNetFail", { err: err?.message ?? String(err) }) }; });
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
						setState(function (prev) { return { ...prev, saveMsg: T("msg.tokenSaved", { api: apiLabel(prev.facts?.api) }) }; });
					} else {
						setState(function (prev) { return { ...prev, saveErr: T("msg.tokenSaveFail", { err: res.payload?.error ?? ("HTTP " + res.status) }) }; });
					}
				} catch (err) {
					setState(function (prev) { return { ...prev, saveErr: T("msg.tokenSaveNetFail", { err: err?.message ?? String(err) }) }; });
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
						setState(function (prev) { return { ...prev, saveMsg: T("msg.tokenCleared") }; });
						await reload();
					} else {
						setState(function (prev) { return { ...prev, saveErr: T("msg.tokenClearFail", { err: res.payload?.error ?? ("HTTP " + res.status) }) }; });
					}
				} catch (err) {
					setState(function (prev) { return { ...prev, saveErr: T("msg.tokenClearNetFail", { err: err?.message ?? String(err) }) }; });
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
						setState(function (prev) { return { ...prev, testMsg: res.payload.message ?? T("msg.testOk") }; });
					} else {
						setState(function (prev) { return { ...prev, testErr: res.payload?.error ?? ("HTTP " + res.status) }; });
					}
				} catch (err) {
					setState(function (prev) { return { ...prev, testErr: T("msg.testNetFail", { err: err?.message ?? String(err) }) }; });
				} finally {
					setBusy(function (b) { return { ...b, [key]: false }; });
				}
			};

			if (state.phase === "loading") {
				return jsx("p", { style: S.hint, children: T("settings.loading") });
			}
			if (state.phase === "error") {
				return jsxs("div", { children: [jsx("p", { style: S.error, children: state.saveErr }), jsx("button", { style: S.button, onClick: function () { setBusy(function (b) { return { ...b, reload: true }; }); reload(true).finally(function () { setBusy(function (b) { return { ...b, reload: false }; }); }); }, children: T("settings.retry") })] });
			}

			var facts = state.facts ?? {};
			var v = state.value;
			var anyBusy = busy.save || busy.reload || busy.token || busy.testToken || busy.testAgent;
			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [
				jsxs("div", { style: S.row, children: [
					jsx("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--dsw-alias-label-primary, #e8e8e8)" }, children: T("settings.title") }),
					facts.tokenConfigured ? jsx("span", { style: S.badgeOk, children: T("badge.tokenOk") }) : jsx("span", { style: S.badgeWarn, children: T("badge.tokenMissing") }),
					jsx("span", { style: S.badge, children: T("badge.current", { api: apiLabel(facts.api) }) }),
				] }),
				jsx("p", { style: S.hint, children: T("settings.intro") }),

				// ---- Token ----
				jsx(Field, { label: T("field.token.label"), badge: facts.tokenConfigured ? T("field.token.badgeConfigured", { src: facts.tokenSource ?? "?" }) : T("field.token.badgeMissing"), hint: T("field.token.hint"), children: jsxs("div", { style: S.row, children: [
					jsx("input", { type: "password", style: { ...S.input, flex: 1 }, value: tokenDraft, placeholder: T("field.token.placeholder"), onChange: (e) => setTokenDraft(e.target.value) }),
					jsx("button", { style: S.buttonPrimary, disabled: busy.token || tokenDraft.length === 0, onClick: saveToken, children: busy.token ? T("action.saving") : T("action.saveToken") }),
					jsx("button", { style: S.button, disabled: busy.token, onClick: clearToken, children: T("action.clear") }),
				] }) }),

				// ---- Basic ----
				jsx(SelectField, { label: T("field.mode.label"), hint: T("field.mode.hint"), badge: "mode", value: v.mode ?? "auto", options: MODES.map(function (m) { return { value: m, label: m + " — " + modeLabel(m) }; }), onChange: (val) => setValue("mode", val) }),
				jsx(SelectField, { label: T("field.model.label"), hint: T("field.model.hint"), value: v.modelVersion ?? "vlm", options: MODELS.map(function (m) { return { value: m, label: modelLabel(m) }; }), onChange: (val) => setValue("modelVersion", val) }),
				jsx(SelectField, { label: T("field.lang.label"), hint: T("field.lang.hint"), value: v.language ?? "ch", options: LANGUAGES.map(function (l) { return { value: l, label: l }; }), onChange: (val) => setValue("language", val) }),
				jsx(CheckField, { label: T("field.table.label"), value: v.enableTable !== false, onChange: (val) => setValue("enableTable", val) }),
				jsx(CheckField, { label: T("field.formula.label"), value: v.enableFormula !== false, onChange: (val) => setValue("enableFormula", val) }),
				jsx(CheckField, { label: T("field.ocr.label"), value: v.isOcr === true, onChange: (val) => setValue("isOcr", val) }),

				jsx(Field, { label: T("field.extra.label"), hint: T("field.extra.hint"), children: jsx("div", { style: S.row, children: EXTRA_FORMATS.map(function (f) {
					var on = Array.isArray(v.extraFormats) && v.extraFormats.indexOf(f) >= 0;
					return jsx("label", { style: { ...S.row, cursor: "pointer" }, children: [jsx("input", { type: "checkbox", checked: on, onChange: function (e) {
						var list = Array.isArray(v.extraFormats) ? v.extraFormats.slice() : [];
						if (e.target.checked) { if (list.indexOf(f) < 0) list.push(f); } else { list = list.filter(function (x) { return x !== f; }); }
						setValue("extraFormats", list);
					} }), jsx("span", { style: { fontSize: 13 }, children: f })] }, f);
				}) }) }),

				// ---- Advanced (collapsed) ----
				jsx("button", { type: "button", style: S.disclosure, onClick: function () { setShowAdvanced(!showAdvanced); }, children: (showAdvanced ? "▾ " : "▸ ") + T("disclosure.advanced") + (dirty && !showAdvanced ? T("disclosure.dirty") : "") }),
				showAdvanced ? jsxs(Fragment, { children: [
					jsx(NumberField, { label: T("adv.timeout.label"), hint: T("adv.timeout.hint"), value: v.timeoutMs, onChange: (val) => setValue("timeoutMs", parseInt(val, 10)) }),
					jsx(NumberField, { label: T("adv.pollInterval.label"), hint: T("adv.pollInterval.hint"), value: v.pollIntervalMs, onChange: (val) => setValue("pollIntervalMs", parseInt(val, 10)) }),
					jsx(NumberField, { label: T("adv.maxFileBytes.label"), hint: T("adv.maxFileBytes.hint"), value: v.maxFileBytes, onChange: (val) => setValue("maxFileBytes", parseInt(val, 10)) }),
					jsx(NumberField, { label: T("adv.inlineMarkdownBytes.label"), hint: T("adv.inlineMarkdownBytes.hint"), value: v.inlineMarkdownBytes, onChange: (val) => setValue("inlineMarkdownBytes", parseInt(val, 10)) }),
					jsx(NumberField, { label: T("adv.submitRate.label"), hint: T("adv.submitRate.hint"), value: v.submitRatePerMin, onChange: (val) => setValue("submitRatePerMin", parseInt(val, 10)) }),
					jsx(NumberField, { label: T("adv.pollRate.label"), hint: T("adv.pollRate.hint"), value: v.pollRatePerMin, onChange: (val) => setValue("pollRatePerMin", parseInt(val, 10)) }),
					jsx(NumberField, { label: T("adv.dailyLimit.label"), hint: T("adv.dailyLimit.hint"), value: v.dailySubmitLimit, onChange: (val) => setValue("dailySubmitLimit", parseInt(val, 10)) }),
					jsx(NumberField, { label: T("adv.urlTtl.label"), hint: T("adv.urlTtl.hint"), value: v.artifactUrlTtlSec, onChange: (val) => setValue("artifactUrlTtlSec", parseInt(val, 10)) }),
					jsx(TextField, { label: T("adv.apiBase.label"), hint: T("adv.apiBase.hint"), value: v.apiBaseUrl, onChange: (val) => setValue("apiBaseUrl", val) }),
					jsx(TextField, { label: T("adv.tokenCredential.label"), hint: T("adv.tokenCredential.hint"), value: v.tokenCredential, onChange: (val) => setValue("tokenCredential", val) }),
					jsx(TextField, { label: T("adv.artifactRoot.label"), hint: T("adv.artifactRoot.hint"), value: v.artifactRootName, onChange: (val) => setValue("artifactRootName", val) }),
				] }) : null,

				// ---- Actions ----
				state.saveMsg ? jsx("p", { style: S.okText, children: state.saveMsg }) : null,
				state.saveErr ? jsx("p", { style: S.error, children: state.saveErr }) : null,
				jsxs("div", { style: { ...S.row, paddingTop: 12, flexWrap: "wrap" }, children: [
					jsx("button", { style: S.buttonPrimary, onClick: save, disabled: anyBusy, children: busy.save ? T("action.saving") : (dirty ? T("action.save") : T("action.saveNoop")) }),
					jsx("button", { style: S.button, disabled: anyBusy, onClick: function () { setBusy(function (b) { return { ...b, reload: true }; }); reload(true).finally(function () { setBusy(function (b) { return { ...b, reload: false }; }); }); }, children: busy.reload ? T("action.loading") : T("action.reload") }),
					jsx("span", { style: { flex: 1 } }),
					jsx("button", { style: S.button, disabled: anyBusy, onClick: function () { return runTest("agent"); }, children: busy.testAgent ? T("action.testingLong") : T("action.testAgent") }),
					jsx("button", { style: S.button, disabled: anyBusy, onClick: function () { return runTest("token"); }, children: busy.testToken ? T("action.testingLong") : T("action.testToken") }),
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
				a.url ? jsx("a", { href: a.url, target: "_blank", rel: "noopener noreferrer", style: { fontSize: 12, color: "var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4d6bfe)" }, children: T("chip.preview") }) : null,
			] }, a.path);
		}

		function MetaCard(props) {
			useLocaleVersion();
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
			useLocaleVersion();
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
						jsx("span", { style: S.badgeWarn, children: T("view.failed") }),
						jsx("p", { style: S.error, children: String(text || T("view.taskFailed")).slice(0, 600) }),
					] });
				}
				return jsx(MetaCard, { meta: meta, openFile: props.openFile });
			}

			// running
			var source = args?.source ?? args?.taskId ?? "";
			return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6, padding: "8px 0" }, children: [
				jsx("span", { style: S.badge, children: T("view.parsing") }),
				jsx("p", { style: S.hint, children: T("view.source", { src: String(source).slice(0, 200) }) }),
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
			var currentSession = function () { return ctx.sessions.list.getSnapshot().current; };
			var hasFiles = function (event) { return event.dataTransfer ? event.dataTransfer.types.includes("Files") : false; };
			var supportedOf = function (list) {
				return Array.from(list ?? []).filter(function (f) { return f && SUPPORTED_DROP_EXT.includes(dropExtOf(f.name)); });
			};
			// The native composer drag overlay can get stuck on for OS-originated
			// drags (dragend never fires inside the browser). Dispatching a
			// synthetic dragend lets the conversation plugin's reset path run.
			var killOverlay = function () {
				try { window.dispatchEvent(new Event("dragend")); } catch { /* ignore */ }
			};
			// Fills the composer draft (never auto-sends): the user keeps control
			// over the final prompt and clicks send themselves.
			var fillDraft = function (sessionId, text) {
				var conversation = ctx.get("conversation");
				var actx = ctx.sessions.scope(sessionId);
				if (!conversation || !actx || typeof conversation.input?.for !== "function") {
					throw new Error(T("err.composer"));
				}
				conversation.input.for(actx).setDraft(text);
			};

			async function intake(files) {
				var sessionId = currentSession();
				if (!sessionId) {
					toast(T("toast.noSession"), "error");
					return;
				}
				var uploaded = [];
				for (var i = 0; i < files.length; i++) {
					var file = files[i];
					if (file.size === 0) { toast(T("toast.emptyFile", { name: file.name }), "error"); continue; }
					if (file.size > DROP_MAX_BYTES) { toast(T("toast.tooLarge", { name: file.name }), "error"); continue; }
					try {
						var url = "/plugin/mineru/upload?sessionId=" + encodeURIComponent(sessionId) + "&name=" + encodeURIComponent(file.name);
						var res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
						var payload = null;
						try { payload = await res.json(); } catch { /* non-JSON */ }
						if (!res.ok || !payload?.ok) throw new Error(payload?.error ?? ("HTTP " + res.status));
						uploaded.push(payload.path);
					} catch (err) {
						toast(T("toast.uploadFail", { name: file.name, err: err?.message ?? String(err) }), "error");
					}
				}
				if (uploaded.length === 0) return;
				// Only the file-list statement goes into the composer draft. The user
				// appends their own requirements and sends; nothing is auto-submitted.
				var text = T("drop.draftText") + uploaded.map(function (p) { return "- " + p; }).join("\n") + "\n\n";
				try {
					fillDraft(sessionId, text);
					toast(T("toast.uploadedN", { n: uploaded.length }));
				} catch (err) {
					toast(T("toast.draftFail", { err: err?.message ?? String(err), paths: uploaded.join("; ") }), "error");
				}
			}

			var overlayKilled = false;
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
				if (!overlayKilled) {
					// First dragover with real files: clear any stuck native overlay
					// (its dragenter may have seen an empty dataTransfer.types list).
					overlayKilled = true;
					killOverlay();
				}
			};
			var onDrop = function (event) {
				if (!hasFiles(event)) return;
				var files = supportedOf(event.dataTransfer.files);
				if (files.length === 0) return;
				event.preventDefault();
				event.stopPropagation();
				overlayKilled = false;
				killOverlay();
				intake(files);
			};
			var onDragEnd = function () { overlayKilled = false; };
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
			document.addEventListener("dragend", onDragEnd, true);
			document.addEventListener("paste", onPaste, true);
			return function () {
				document.removeEventListener("dragenter", onDragEnter, true);
				document.removeEventListener("dragover", onDragOver, true);
				document.removeEventListener("drop", onDrop, true);
				document.removeEventListener("dragend", onDragEnd, true);
				document.removeEventListener("paste", onPaste, true);
			};
		}

		// ------------------------------------------------------------------
		// Plugin entry
		// ------------------------------------------------------------------
		var inject = ["slots", "connection", "sessions", "conversation", "locale"];

		function apply(ctx) {
			// Register zh/en dictionaries with the host locale service. If the
			// service is absent (older host), the zh dict remains the fallback.
			if (ctx.locale) {
				try {
					ctx.effect(function () { return ctx.locale.register(NS, { zh: DICTS.zh, en: DICTS.en }); }, "dsh-mineru: dictionaries");
					ctx.effect(function () {
						var dis = [];
						for (var loc in DICTS) dis.push(ctx.locale.register(NS, loc, DICTS[loc]));
						return function () { for (var i = 0; i < dis.length; i++) dis[i](); };
					}, "dsh-mineru: language-pack dictionaries");
					ctx.effect(function () {
						var rebind = function () {
							currentT = ctx.locale.bind(NS) || currentT;
							localeVersion += 1;
							for (var i = 0; i < localeSubs.length; i++) localeSubs[i]();
						};
						rebind();
						var obs = new MutationObserver(rebind);
						obs.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
						return function () { obs.disconnect(); };
					}, "dsh-mineru: locale watcher");
				} catch (e) { /* locale service unavailable: zh fallback stays */ }
			}

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
