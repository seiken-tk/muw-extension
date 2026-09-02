'use strict';

// muw コンテンツスクリプト
// ON のときだけ、表示領域内のリンク(rel属性)と画像(alt属性)の上にオーバーレイを描画する。
// OFF のときは MutationObserver も止め、ページに負荷をかけない。
(() => {
  const CLASS_CONTAINER = 'muw-container';
  const CLASS_HIGHLIGHT = 'muw-rel-highlight';
  const CLASS_OVERLAY = 'muw-alt-overlay';
  const CLASS_LEGEND = 'muw-legend';
  const OWN_SELECTOR = `.${CLASS_CONTAINER}, .${CLASS_HIGHLIGHT}, .${CLASS_OVERLAY}, .${CLASS_LEGEND}`;
  const UPDATE_DELAY_MS = 200;

  const REL_STYLES = [
    { test: (rel) => rel.includes('nofollow'), color: '#FF5733', type: 'nofollow' },
    { test: (rel) => rel.includes('ugc'), color: '#33FF57', type: 'ugc' },
    { test: (rel) => rel.includes('sponsored'), color: '#3357FF', type: 'sponsored' },
    { test: (rel) => rel === '', color: '#FFFF33', type: 'rel属性なし' },
    { test: () => true, color: '#FF33FF', type: 'その他' },
  ];

  let isActive = false;
  let container = null; // ハイライト・オーバーレイをまとめて入れる親要素
  let legendElement = null;
  let observer = null;
  let updateTimer = null;

  // ---------- 描画 ----------

  function isInViewport(rect) {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top < window.innerHeight &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.right > 0
    );
  }

  function ensureContainer() {
    if (container && container.isConnected) return container;
    container = document.createElement('div');
    container.className = CLASS_CONTAINER;
    // body の margin や position の影響を受けないよう html 直下に置く
    Object.assign(container.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '0',
      height: '0',
      overflow: 'visible',
      zIndex: '2147483646',
      pointerEvents: 'none',
    });
    document.documentElement.appendChild(container);
    return container;
  }

  function createHighlight(link, scrollX, scrollY) {
    const rect = link.getBoundingClientRect();
    if (!isInViewport(rect)) return null;

    const rel = link.getAttribute('rel') || '';
    const style = REL_STYLES.find((s) => s.test(rel));

    const el = document.createElement('div');
    el.className = CLASS_HIGHLIGHT;
    el.dataset.relType = style.type;
    Object.assign(el.style, {
      position: 'absolute',
      border: `2px solid ${style.color}`,
      boxSizing: 'border-box',
      pointerEvents: 'none',
      left: `${rect.left + scrollX}px`,
      top: `${rect.top + scrollY}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    return el;
  }

  function createAltOverlay(img, scrollX, scrollY) {
    const rect = img.getBoundingClientRect();
    if (!isInViewport(rect)) return null;

    const altText = img.getAttribute('alt') || '【alt属性なし】';
    const el = document.createElement('div');
    el.className = CLASS_OVERLAY;
    Object.assign(el.style, {
      position: 'absolute',
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      color: 'white',
      padding: '5px',
      fontSize: '12px',
      maxWidth: '100%',
      wordBreak: 'break-all',
      pointerEvents: 'none',
      left: `${rect.left + scrollX}px`,
      top: `${rect.top + scrollY}px`,
      width: `${rect.width}px`,
    });
    el.textContent = `alt: ${altText}`;
    return el;
  }

  function render() {
    if (!isActive) return;
    try {
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const fragment = document.createDocumentFragment();

      for (const link of document.querySelectorAll('a')) {
        const el = createHighlight(link, scrollX, scrollY);
        if (el) fragment.appendChild(el);
      }
      for (const img of document.images) {
        const el = createAltOverlay(img, scrollX, scrollY);
        if (el) fragment.appendChild(el);
      }

      // 一括で差し替える（要素を個別に削除・追加するより速い）
      ensureContainer().replaceChildren(fragment);
      showLegend();
    } catch (error) {
      console.error('muw: 描画エラー', error);
    } finally {
      // 自分自身の DOM 変更で MutationObserver が再発火しないよう記録を捨てる
      if (observer) observer.takeRecords();
    }
  }

  function showLegend() {
    if (legendElement && legendElement.isConnected) return;
    legendElement = document.createElement('div');
    legendElement.className = CLASS_LEGEND;
    Object.assign(legendElement.style, {
      position: 'fixed',
      top: '10px',
      right: '10px',
      backgroundColor: 'rgba(255, 255, 255, 0.9)',
      color: '#000',
      border: '1px solid #ccc',
      borderRadius: '5px',
      padding: '10px',
      zIndex: '2147483647',
      fontSize: '12px',
      boxShadow: '0 2px 5px rgba(0, 0, 0, 0.2)',
    });

    const title = document.createElement('div');
    title.textContent = 'muw - リンク属性の凡例';
    Object.assign(title.style, {
      fontWeight: 'bold',
      marginBottom: '5px',
      borderBottom: '1px solid #ccc',
      paddingBottom: '5px',
    });
    legendElement.appendChild(title);

    for (const { color, type } of REL_STYLES) {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', marginTop: '5px' });
      const swatch = document.createElement('div');
      Object.assign(swatch.style, {
        width: '15px',
        height: '15px',
        backgroundColor: color,
        marginRight: '5px',
        border: '1px solid #000',
      });
      const label = document.createElement('span');
      label.textContent = type;
      row.append(swatch, label);
      legendElement.appendChild(row);
    }

    document.documentElement.appendChild(legendElement);
  }

  // 自分が追加した要素をすべて削除する
  // （拡張機能の再読み込み前に残った古い要素も同じセレクタで拾う）
  function clearAll() {
    container = null;
    legendElement = null;
    document.querySelectorAll(OWN_SELECTOR).forEach((el) => el.remove());
    if (observer) observer.takeRecords();
  }

  // ---------- 更新のスケジューリング ----------

  function scheduleUpdate() {
    if (!isActive || updateTimer !== null) return;
    updateTimer = setTimeout(() => {
      updateTimer = null;
      render();
    }, UPDATE_DELAY_MS);
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
    if (updateTimer !== null) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }
  }

  // ---------- 状態管理 ----------

  function setActive(next) {
    const value = next === true;
    if (value === isActive) return;
    isActive = value;
    if (isActive) {
      startObserver();
      render();
    } else {
      stopObserver();
      clearAll();
    }
  }

  function requestState() {
    try {
      chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && typeof response.isActive === 'boolean') {
          setActive(response.isActive);
        }
      });
    } catch (error) {
      // 拡張機能が更新・無効化された後は例外になるため無視
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === 'toggle' || message?.action === 'updateState') {
      setActive(message.isActive);
      sendResponse({ status: 'success' });
    }
  });

  // ---------- 初期化 ----------

  function initialize() {
    clearAll();

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate, { passive: true });
    window.addEventListener('popstate', scheduleUpdate);
    window.addEventListener('hashchange', scheduleUpdate);

    // タブが再表示されたときに最新の ON/OFF 状態を取り直す
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') requestState();
    });

    requestState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
})();
