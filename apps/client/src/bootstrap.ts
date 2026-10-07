import './style.css';
const root = document.querySelector<HTMLElement>('#app')!;
root.innerHTML = `<div class="boot-screen"><span class="brand-mark">ct<span>✳</span></span><h1>Hẹn nhau ở sân trường.</h1><p>Đang mở cổng sân trường…</p><span class="spinner"></span></div>`;
void import('./main.js').catch((error: unknown) => {
  root.innerHTML = `<div class="boot-screen"><h1>Chưa mở được sân trường</h1><p>Kiểm tra kết nối rồi tải lại trang nhé.</p><button class="primary" id="boot-retry">Tải lại</button></div>`;
  document.querySelector('#boot-retry')!.addEventListener('click', () => location.reload());
  if (error instanceof Error && error.message.includes('VITE_SERVER_URL')) root.querySelector('p')!.textContent = error.message;
});
