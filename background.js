// グローバル変数
let isActive = false;

// アイコンを更新する関数
function updateIcon() {
  const iconPath = isActive ? {
    16: "images/icon16.png",
    48: "images/icon48.png",
    128: "images/icon128.png"
  } : {
    16: "images/icon16_gray.png",
    48: "images/icon48_gray.png",
    128: "images/icon128_gray.png"
  };
  
  chrome.action.setIcon({ path: iconPath });
  chrome.action.setTitle({ title: isActive ? "muw (ON)" : "muw (OFF)" });
}

// 状態を切り替える関数
function toggleState(tab) {
  // タブが有効かどうかを確認
  if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
    console.log('このページでは拡張機能を実行できません');
    return;
  }

  // 状態を切り替え
  isActive = !isActive;
  
  // アイコンとタイトルを更新
  updateIcon();
  
  // 現在のタブにメッセージを送信
  try {
    chrome.tabs.sendMessage(
      tab.id,
      { action: 'toggle', isActive: isActive },
      (response) => {
        // レスポンスの処理（オプション）
        if (chrome.runtime.lastError) {
          console.error('メッセージ送信エラー:', chrome.runtime.lastError.message);
          // エラーが発生した場合でも処理を続行
          return;
        }
        
        if (response && response.status === 'success') {
          console.log('表示状態を切り替えました:', isActive ? 'ON' : 'OFF');
        } else {
          console.log('応答を受信しましたが、ステータスが不明です');
        }
      }
    );
    
    // すべてのタブに状態変更を通知
    updateAllTabs();
    
  } catch (error) {
    console.error('メッセージ送信中に例外が発生しました:', error);
  }
}

// すべてのタブに状態を通知する関数
function updateAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      // chrome:// や edge:// などの特殊なページは除外
      if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://') && !tab.url.startsWith('about:')) {
        try {
          chrome.tabs.sendMessage(
            tab.id,
            { action: 'updateState', isActive: isActive },
            // エラーは無視（一部のタブでエラーが発生しても処理を続行）
            () => {
              if (chrome.runtime.lastError) {
                // エラーは無視
              }
            }
          );
        } catch (error) {
          // エラーは無視
        }
      }
    });
  });
}

// 左クリック：muw.jpに移動して解析開始
chrome.action.onClicked.addListener((tab) => {
  // 現在のタブのURLを取得
  const currentUrl = tab.url;
  
  // muw.jpに移動して、ページ読み込み完了後にURLを入力して解析開始
  chrome.tabs.create({ url: 'https://muw.jp/' }, (newTab) => {
    // ページ読み込み完了を待つ
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo, updatedTab) {
      // 該当するタブかつ読み込みが完了したかを確認
      if (tabId === newTab.id && changeInfo.status === 'complete') {
        // リスナーを削除（一度だけ実行するため）
        chrome.tabs.onUpdated.removeListener(listener);
        
        // URLを入力して解析を開始するスクリプトを実行
        chrome.scripting.executeScript({
          target: { tabId: newTab.id },
          function: (url) => {
            // URLを入力
            const urlInput = document.getElementById('url-input');
            if (urlInput) {
              urlInput.value = url;
              
              // 解析開始ボタンをクリック
              const analyzeBtn = document.getElementById('analyze-btn');
              if (analyzeBtn) {
                analyzeBtn.click();
              }
            }
          },
          args: [currentUrl]
        });
      }
    });
  });
});

// 右クリックメニューの作成
chrome.runtime.onInstalled.addListener(() => {
  console.log('muw拡張機能がインストールされました');
  
  // 初期状態は非アクティブ
  isActive = false;
  
  // 初期アイコンとタイトル設定
  updateIcon();
  
  // 右クリックメニューの作成
  chrome.contextMenus.create({
    id: 'toggle-muw',
    title: 'ON/OFF切り替え',
    contexts: ['action']
  });
});

// 右クリックメニューのクリックイベント
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'toggle-muw') {
    toggleState(tab);
  }
});

// content.jsからの状態取得リクエストに応答
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getState') {
    sendResponse({ isActive: isActive });
    return true; // 非同期レスポンスのためtrueを返す
  }
});
