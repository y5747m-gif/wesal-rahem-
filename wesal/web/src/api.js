// طبقة الاتصال بالخادم — كل الطلبات تمر من هنا
const TOKEN_KEY = 'wesal_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export async function api(path, { method = 'GET', body, silent = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* استجابة بدون JSON */
  }
  if (!res.ok) {
    if (res.status === 401 && !silent) {
      setToken(null);
      if (!location.hash.includes('login')) window.dispatchEvent(new Event('wesal:logout'));
    }
    const err = new Error(data?.message || 'حدث خطأ غير متوقع.');
    err.status = res.status;
    throw err;
  }
  return data;
}
