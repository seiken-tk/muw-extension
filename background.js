'use strict';

// ON/OFF 状態は storage.session に保存する
// （Service Worker はいつでも終了・再起動されるため、メモリ上の変数では状態が失われる）
const STATE_KEY = 'muwActive';
const MUW_URL = 'https://muw.jp/';
const MENU_TOGGLE_ID = 'toggle-muw';

async function getActive() {
  try {
    const { [STATE_KEY]: active } = await chrome.storage.session.get({ [STATE_KEY]: false });
    return active === true;
  } catch (error) {
    return false;
  }
}

async function setActive(isActive) {
  await chrome.storage.session.set({ [STATE_KEY]: isActive });
}

function updateIcon(isActive) {
  const suffix = isActive ? '' : '_gray';
  chrome.action.setIcon({
    path: {
      16: `images/icon16${suffix}.png`,
      48: `images/icon48${suffix}.png`,
      128: `images/icon128${suffix}.png`,
    },
  });
  chrome.action.setTitle({ title: isActive ? 'muw (ON)' : 'muw (OFF)' });
}

function isWebUrl(url) {
  return typeof url === 'string' && /^https?:/i.test(url);
}

// 全タブのコンテンツスクリプトへ状態を通知する（未注入のタブはエラーになるので無視）
async function notifyAllTabs(isActive) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.map((tab) =>
      chrome.tabs.sendMessage(tab.id, { action: 'updateState', isActive }).catch(() => {})
    )
  );
}

async function toggleState() {
  const isActive = !(await getActive());
  await setActive(isActive);
  updateIcon(isActive);
  await notifyAllTabs(isActive);
}

// muw.jp 上で実行される関数（拡張機能のコンテキストは参照できない）
function fillAndAnalyze(url) {
  const urlInput = document.getElementById('url-input');
  if (!urlInput) return;
  urlInput.value = url;
  urlInput.dispatchEvent(new Event('input', { bubbles: true }));
  const analyzeBtn = document.getElementById('analyze-btn');
  if (analyzeBtn) analyzeBtn.click();
}

// 左クリック：muw.jp を開き、現在のページURLを入力して解析を開始する
chrome.action.onClicked.addListener(async (tab) => {
  const currentUrl = tab?.url;
  const newTab = await chrome.tabs.create({ url: MUW_URL });
  if (!isWebUrl(currentUrl)) return;

  const cleanup = () => {
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
  };
  const onUpdated = (tabId, changeInfo) => {
    if (tabId !== newTab.id || changeInfo.status !== 'complete') return;
    cleanup();
    chrome.scripting
      .executeScript({ target: { tabId }, func: fillAndAnalyze, args: [currentUrl] })
      .catch((error) => console.error('muw: 解析開始スクリプトの実行に失敗しました', error));
  };
  // 読み込み完了前にタブが閉じられた場合にリスナーが残らないようにする
  const onRemoved = (tabId) => {
    if (tabId === newTab.id) cleanup();
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
});

// インストール時：右クリックメニューを作成し、OFF 状態のアイコンにする
chrome.runtime.onInstalled.addListener(async () => {
  await setActive(false);
  updateIcon(false);
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_TOGGLE_ID,
    title: 'ON/OFF切り替え',
    contexts: ['action'],
  });
});

// ブラウザ起動時：storage.session は空になるので OFF 状態から始める
chrome.runtime.onStartup.addListener(() => {
  updateIcon(false);
});

// 右クリックメニュー：ON/OFF 切り替え
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_TOGGLE_ID) {
    toggleState();
  }
});

// コンテンツスクリプトからの状態取得リクエストに応答
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'getState') {
    getActive().then((isActive) => sendResponse({ isActive }));
    return true; // 非同期レスポンス
  }
});
