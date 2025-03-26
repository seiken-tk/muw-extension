// グローバル変数
let isActive = false;
let relHighlightElements = [];
let altOverlayElements = [];
let legendElement = null;
let observer = null;
let updateTimeout = null;
let isUpdating = false;

// background.jsからのメッセージを受け取る
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggle') {
    isActive = message.isActive;
    
    // 同期的に処理して即座にレスポンスを返す
    toggleVisibility(isActive);
    sendResponse({ status: 'success' });
  } else if (message.action === 'updateState') {
    // 他のタブでの状態変更を反映
    isActive = message.isActive;
    toggleVisibility(isActive);
    
    // レスポンスを返す（オプション）
    if (sendResponse) {
      sendResponse({ status: 'success' });
    }
  }
  // 非同期処理を行う場合はtrueを返す（今回は同期的に処理しているが念のため）
  return true;
});

// 初期化処理
function initialize() {
  console.log('muw content script initialized');
  
  // 初期状態は非表示（後でbackground.jsから現在の状態を取得）
  isActive = false;
  
  // 初期化時に一度すべての要素を削除（既存の要素がある場合に備えて）
  forceRemoveAllElements();
  
  // 軽量化したMutationObserverを設定
  setupLightMutationObserver();
  
  // デバウンスされたスクロールとリサイズイベントを設定
  setupDebouncedEvents();
  
  // ページ遷移検知のイベントリスナーを設定
  setupNavigationListeners();
  
  // 初期化完了フラグ（初回OFF用）
  window.muwInitialized = true;
  
  // background.jsから現在の状態を取得
  chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('状態取得エラー:', chrome.runtime.lastError.message);
      return;
    }
    
    if (response && response.isActive !== undefined) {
      isActive = response.isActive;
      
      // ON状態であれば表示を更新
      if (isActive) {
        toggleVisibility(true);
      }
    }
  });
}

// 軽量化したMutationObserverを設定
function setupLightMutationObserver() {
  if (document.body && !observer) {
    observer = new MutationObserver((mutations) => {
      if (isActive && !isUpdating) {
        // 変更があった場合のみ再処理（デバウンス処理）
        if (updateTimeout) {
          clearTimeout(updateTimeout);
        }
        
        updateTimeout = setTimeout(() => {
          updateVisuals();
        }, 500); // 500ms間隔で更新を制限
      }
    });
    
    // 監視設定を最小限に
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });
    
    console.log('muw MutationObserver設定完了');
  } else if (!document.body) {
    // bodyがまだ読み込まれていない場合は再試行
    setTimeout(setupLightMutationObserver, 100);
  }
}

// デバウンスされたイベントを設定
function setupDebouncedEvents() {
  // スクロールイベントのデバウンス処理
  let scrollTimeout = null;
  window.addEventListener('scroll', () => {
    if (isActive) {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      scrollTimeout = setTimeout(() => {
        updateVisuals();
      }, 200); // 200ms間隔でスクロール更新を制限
    }
  }, { passive: true }); // パフォーマンス向上のためpassiveオプションを追加
  
  // リサイズイベントのデバウンス処理
  let resizeTimeout = null;
  window.addEventListener('resize', () => {
    if (isActive) {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeTimeout = setTimeout(() => {
        updateVisuals();
      }, 200); // 200ms間隔でリサイズ更新を制限
    }
  }, { passive: true });
}

// ページ遷移検知のイベントリスナーを設定
function setupNavigationListeners() {
  // History APIによるページ遷移を検知
  window.addEventListener('popstate', () => {
    if (isActive) {
      // 少し遅延させて実行（DOMの更新を待つため）
      setTimeout(() => {
        updateVisuals();
      }, 300);
    }
  });
  
  // ハッシュ変更によるページ内遷移を検知
  window.addEventListener('hashchange', () => {
    if (isActive) {
      // 少し遅延させて実行（DOMの更新を待つため）
      setTimeout(() => {
        updateVisuals();
      }, 300);
    }
  });
  
  // MutationObserverでURLの変更を検知（SPAなどで使用）
  const urlObserver = new MutationObserver((mutations) => {
    if (isActive) {
      // 現在のURLを保存
      const currentUrl = window.location.href;
      
      // URLが変わったかチェック
      if (currentUrl !== window.lastKnownUrl) {
        window.lastKnownUrl = currentUrl;
        
        // 少し遅延させて実行（DOMの更新を待つため）
        setTimeout(() => {
          updateVisuals();
        }, 500);
      }
    }
  });
  
  // 初期URLを保存
  window.lastKnownUrl = window.location.href;
  
  // bodyの変更を監視（SPAでのページ遷移検知用）
  if (document.body) {
    urlObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });
  }
  
  // タブがアクティブになった時に状態を再確認
  document.addEventListener('visibilitychange', () => {
    // タブがアクティブになった時
    if (document.visibilityState === 'visible') {
      // background.jsから最新の状態を取得
      chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('状態取得エラー:', chrome.runtime.lastError.message);
          return;
        }
        
        if (response && response.isActive !== undefined) {
          // 状態が変わっていれば更新
          if (isActive !== response.isActive) {
            isActive = response.isActive;
            toggleVisibility(isActive);
          }
        }
      });
    }
  });
}

// 表示/非表示を切り替える関数
function toggleVisibility(show) {
  try {
    if (show) {
      updateVisuals();
    } else {
      // 強制的にすべての要素を削除（確実に消去）
      forceRemoveAllElements();
      
      // 初回のOFF操作時は特別な処理を追加
      if (window.muwInitialized && !window.muwFirstOffDone) {
        console.log('初回OFF操作を検出: 追加の削除処理を実行');
        
        // 少し遅延させて再度削除処理を実行（非同期処理の完了を待つため）
        setTimeout(() => {
          forceRemoveAllElements();
          
          // さらに遅延させて3回目の削除処理を実行
          setTimeout(() => {
            forceRemoveAllElements();
            window.muwFirstOffDone = true;
          }, 100);
        }, 100);
      }
    }
  } catch (error) {
    console.error('表示切替エラー:', error);
  }
}

// すべての要素を強制的に削除する関数（徹底的に削除）
function forceRemoveAllElements() {
  try {
    // 更新中フラグを設定（MutationObserverの処理を防止）
    isUpdating = true;
    
    // 通常のクリア処理
    clearHighlights();
    hideLegend();
    
    // 1. クラス名で要素を検索して削除（念のため）
    const classesToRemove = ['.muw-rel-highlight', '.muw-alt-overlay', '.muw-legend'];
    
    classesToRemove.forEach(className => {
      const elements = document.querySelectorAll(className);
      elements.forEach(el => {
        try {
          if (el && el.parentNode) {
            el.parentNode.removeChild(el);
          }
        } catch (err) {
          // エラーは無視して続行
        }
      });
    });
    
    // 2. document.bodyの直接の子要素をチェック
    Array.from(document.body.children).forEach(child => {
      try {
        if (child.className &&
            (child.className.includes('muw-rel-highlight') ||
             child.className.includes('muw-alt-overlay') ||
             child.className.includes('muw-legend'))) {
          document.body.removeChild(child);
        }
      } catch (err) {
        // エラーは無視して続行
      }
    });
    
    // 3. 属性セレクタを使用して検索（クラス名が変更されている可能性に対応）
    const attrElements = document.querySelectorAll('[data-rel-type]');
    attrElements.forEach(el => {
      try {
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
      } catch (err) {
        // エラーは無視して続行
      }
    });
    
    // 4. スタイル属性で検索（位置指定されている要素）
    const positionedElements = document.querySelectorAll('div[style*="position"]');
    positionedElements.forEach(el => {
      try {
        if (el.className && (
            el.className.includes('muw') ||
            el.hasAttribute('data-rel-type'))) {
          if (el.parentNode) {
            el.parentNode.removeChild(el);
          }
        }
      } catch (err) {
        // エラーは無視して続行
      }
    });
    
    // 5. innerHTML内のmuwクラスを持つ要素を検索
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
      try {
        if (el.innerHTML && el.innerHTML.includes('muw-')) {
          // muwクラスを含む子要素を持つ可能性がある
          const muwChildren = el.querySelectorAll('[class*="muw-"]');
          muwChildren.forEach(child => {
            try {
              if (child.parentNode) {
                child.parentNode.removeChild(child);
              }
            } catch (err) {
              // エラーは無視
            }
          });
        }
      } catch (err) {
        // エラーは無視して続行
      }
    });
    
    // グローバル配列をクリア
    relHighlightElements = [];
    altOverlayElements = [];
    legendElement = null;
    
    // 6. MutationObserverを一時的に無効化（再追加を防止）
    if (observer) {
      observer.disconnect();
      setTimeout(() => {
        if (document.body) {
          setupLightMutationObserver();
          // 更新中フラグを解除
          isUpdating = false;
        }
      }, 500);
    } else {
      // 更新中フラグを解除
      isUpdating = false;
    }
    
    console.log('muw: すべての要素を徹底的に削除しました');
  } catch (e) {
    console.error('要素強制削除エラー:', e);
    // エラーが発生した場合も更新中フラグを解除
    isUpdating = false;
  }
}

// 視覚要素を更新する関数（一括処理）
function updateVisuals() {
  if (isUpdating) return; // 既に更新中なら処理しない
  
  isUpdating = true;
  
  try {
    // 既存の要素をクリア
    clearHighlights();
    
    // バッチ処理で要素を作成
    const fragment = document.createDocumentFragment();
    
    // リンクのハイライト
    const links = document.querySelectorAll('a');
    const visibleLinks = Array.from(links).filter(isElementVisible);
    
    visibleLinks.forEach(link => {
      try {
        const relValue = link.getAttribute('rel') || '';
        let borderColor = '';
        let relType = '';
        
        // rel属性の値に基づいて色を決定
        if (relValue.includes('nofollow')) {
          borderColor = '#FF5733'; // 赤色
          relType = 'nofollow';
        } else if (relValue.includes('ugc')) {
          borderColor = '#33FF57'; // 緑色
          relType = 'ugc';
        } else if (relValue.includes('sponsored')) {
          borderColor = '#3357FF'; // 青色
          relType = 'sponsored';
        } else if (relValue === '') {
          borderColor = '#FFFF33'; // 黄色
          relType = 'rel属性なし';
        } else {
          borderColor = '#FF33FF'; // マゼンタ
          relType = 'その他';
        }
        
        // ハイライト要素を作成
        const highlight = document.createElement('div');
        highlight.className = 'muw-rel-highlight';
        highlight.style.position = 'absolute';
        highlight.style.border = `2px solid ${borderColor}`;
        highlight.style.boxSizing = 'border-box';
        highlight.style.pointerEvents = 'none';
        highlight.style.zIndex = '9999';
        
        // リンクの位置とサイズを取得
        const rect = link.getBoundingClientRect();
        highlight.style.left = rect.left + window.scrollX + 'px';
        highlight.style.top = rect.top + window.scrollY + 'px';
        highlight.style.width = rect.width + 'px';
        highlight.style.height = rect.height + 'px';
        
        // データ属性を追加
        highlight.dataset.relType = relType;
        
        // フラグメントに追加
        fragment.appendChild(highlight);
        relHighlightElements.push(highlight);
      } catch (e) {
        // エラーは無視して続行
      }
    });
    
    // 画像のalt属性
    const images = document.querySelectorAll('img');
    const visibleImages = Array.from(images).filter(isElementVisible);
    
    visibleImages.forEach(img => {
      try {
        const altText = img.getAttribute('alt') || '【alt属性なし】';
        
        // オーバーレイ要素を作成
        const overlay = document.createElement('div');
        overlay.className = 'muw-alt-overlay';
        overlay.style.position = 'absolute';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        overlay.style.color = 'white';
        overlay.style.padding = '5px';
        overlay.style.fontSize = '12px';
        overlay.style.maxWidth = '100%';
        overlay.style.wordBreak = 'break-all';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '10000';
        overlay.textContent = `alt: ${altText}`;
        
        // 画像の位置とサイズを取得
        const rect = img.getBoundingClientRect();
        overlay.style.left = rect.left + window.scrollX + 'px';
        overlay.style.top = rect.top + window.scrollY + 'px';
        overlay.style.width = rect.width + 'px';
        
        // フラグメントに追加
        fragment.appendChild(overlay);
        altOverlayElements.push(overlay);
      } catch (e) {
        // エラーは無視して続行
      }
    });
    
    // 一括でDOMに追加（パフォーマンス向上）
    document.body.appendChild(fragment);
    
    // 凡例を表示
    showLegend();
  } catch (e) {
    console.error('視覚要素更新エラー:', e);
  } finally {
    isUpdating = false;
  }
}

// 要素が表示されているかチェック（非表示要素の処理を省略）
function isElementVisible(element) {
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.top < window.innerHeight &&
    rect.bottom > 0 &&
    rect.left < window.innerWidth &&
    rect.right > 0
  );
}

// 凡例の表示
function showLegend() {
  try {
    // 既存の凡例を削除
    hideLegend();
    
    // 凡例要素を作成
    legendElement = document.createElement('div');
    legendElement.className = 'muw-legend';
    legendElement.style.position = 'fixed';
    legendElement.style.top = '10px';
    legendElement.style.right = '10px';
    legendElement.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
    legendElement.style.border = '1px solid #ccc';
    legendElement.style.borderRadius = '5px';
    legendElement.style.padding = '10px';
    legendElement.style.zIndex = '10001';
    legendElement.style.fontSize = '12px';
    legendElement.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
    
    // 凡例のHTML（一括設定でパフォーマンス向上）
    legendElement.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 5px; border-bottom: 1px solid #ccc; padding-bottom: 5px;">
        muw - リンク属性の凡例
      </div>
      <div style="display: flex; align-items: center; margin-top: 5px;">
        <div style="width: 15px; height: 15px; background-color: #FF5733; margin-right: 5px; border: 1px solid #000;"></div>
        <span>nofollow</span>
      </div>
      <div style="display: flex; align-items: center; margin-top: 5px;">
        <div style="width: 15px; height: 15px; background-color: #33FF57; margin-right: 5px; border: 1px solid #000;"></div>
        <span>ugc</span>
      </div>
      <div style="display: flex; align-items: center; margin-top: 5px;">
        <div style="width: 15px; height: 15px; background-color: #3357FF; margin-right: 5px; border: 1px solid #000;"></div>
        <span>sponsored</span>
      </div>
      <div style="display: flex; align-items: center; margin-top: 5px;">
        <div style="width: 15px; height: 15px; background-color: #FFFF33; margin-right: 5px; border: 1px solid #000;"></div>
        <span>rel属性なし</span>
      </div>
      <div style="display: flex; align-items: center; margin-top: 5px;">
        <div style="width: 15px; height: 15px; background-color: #FF33FF; margin-right: 5px; border: 1px solid #000;"></div>
        <span>その他</span>
      </div>
    `;
    
    // 凡例をドキュメントに追加
    document.body.appendChild(legendElement);
  } catch (e) {
    console.error('凡例表示エラー:', e);
  }
}

// 凡例の非表示（徹底的に削除）
function hideLegend() {
  try {
    // 1. 保存された凡例要素を削除
    if (legendElement) {
      try {
        if (legendElement.parentNode) {
          legendElement.parentNode.removeChild(legendElement);
        } else {
          legendElement.remove();
        }
      } catch (err) {
        // エラーは無視
      }
    }
    
    // 2. クラス名で検索して削除（複数の方法で）
    const legends = document.querySelectorAll('.muw-legend');
    legends.forEach(el => {
      try {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        } else {
          el.remove();
        }
      } catch (err) {
        // エラーは無視
      }
    });
    
    // 3. スタイルで検索（位置が固定されている要素）
    const fixedElements = document.querySelectorAll('div[style*="position: fixed"][style*="right: 10px"][style*="top: 10px"]');
    fixedElements.forEach(el => {
      try {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      } catch (err) {
        // エラーは無視
      }
    });
    
    legendElement = null;
  } catch (e) {
    console.error('凡例非表示エラー:', e);
  }
}

// ハイライトのクリア（徹底的に削除）
function clearHighlights() {
  try {
    // 1. 保存された要素を削除
    const removeElement = (element) => {
      try {
        if (element) {
          if (element.parentNode) {
            element.parentNode.removeChild(element);
          } else {
            element.remove();
          }
        }
      } catch (err) {
        // エラーは無視
      }
    };
    
    // 保存された配列の要素を削除
    relHighlightElements.forEach(removeElement);
    altOverlayElements.forEach(removeElement);
    
    // 2. クラス名で検索して削除（複数の方法で）
    const removeElementsByClass = (className) => {
      const elements = document.querySelectorAll(className);
      elements.forEach(el => {
        try {
          if (el.parentNode) {
            el.parentNode.removeChild(el);
          } else {
            el.remove();
          }
        } catch (err) {
          // エラーは無視
        }
      });
    };
    
    removeElementsByClass('.muw-rel-highlight');
    removeElementsByClass('.muw-alt-overlay');
    
    // 3. スタイルで検索（絶対位置指定されている要素）
    const absoluteElements = document.querySelectorAll('div[style*="position: absolute"]');
    absoluteElements.forEach(el => {
      try {
        // muwに関連する要素かチェック
        if (el.className && (
            el.className.includes('muw-rel-highlight') ||
            el.className.includes('muw-alt-overlay'))) {
          if (el.parentNode) {
            el.parentNode.removeChild(el);
          }
        }
      } catch (err) {
        // エラーは無視
      }
    });
    
    // 4. データ属性で検索
    const dataElements = document.querySelectorAll('[data-rel-type]');
    dataElements.forEach(el => {
      try {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      } catch (err) {
        // エラーは無視
      }
    });
    
    // 配列をクリア
    relHighlightElements = [];
    altOverlayElements = [];
  } catch (e) {
    console.error('ハイライトクリアエラー:', e);
  }
}

// DOMの読み込み完了を待つ
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}