export function loginErrorMessage(error: unknown, online = true): string {
  const info = error as { code?: string; status?: number; name?: string; message?: string } | null;
  if (!online) return "网络已断开，请恢复连接后重试。";
  if (info?.code === "invalid_credentials") return "邮箱或密码不正确，请核对后重试。测试账号请使用本机保存的新密码。";
  if (info?.status === 429 || info?.code === "over_request_rate_limit") return "登录尝试过于频繁，请稍等片刻再试。";
  if (info?.code === "email_not_confirmed") return "这个账号的邮箱尚未验证，请先完成邮箱验证。";
  if (info?.name === "AuthRetryableFetchError" || info?.name === "AbortError" || info?.name === "TimeoutError" || /fetch|network|timeout/i.test(info?.message ?? "")) return "暂时连接不上登录服务，请检查网络后重试；这不代表密码错误。";
  if (info?.status && info.status >= 500) return "登录服务暂时不可用，请稍后重试。";
  return "暂时无法完成登录，请刷新页面后重试。";
}
