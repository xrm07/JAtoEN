GitHub ActionsにおけるManifest V3拡張機能のE2Eテスト不安定性に関する包括的分析と解決策I. エグゼクティブアナリシス：MV3 E2Eテストの不安定性の解体A. 中核仮説の検証提示された調査結果とログは、GitHub Actions環境で観測されるE2E（End-to-End）テストのタイムアウトエラーが、根本的な競合状態（レースコンディション）に起因することを示唆しており、この仮説は技術的に妥当であると判断される。観測されている「SW not detected before navigation」（Service Workerがナビゲーション前に未検出）という事象、それに続くコンテンツスクリプトの注入失敗、そして最終的なTimeoutErrorは、Manifest V3（MV3）アーキテクチャに内在する非同期性と、高速に実行される自動化スクリプトとの間のタイミングのずれが引き起こす典型的な症状である。この問題は単なる実装上のバグではなく、MV3の設計思想そのものから生じる構造的な課題である。MV3のService Worker（SW）は、特に自動化されたテスト環境下で、時として「デッドモード」に陥り、拡張機能の再読み込みなしには再起動しないことがあるという報告がChromiumの課題追跡システムにも複数存在する 1。提供されたログにあるSW not detectedというメッセージは、この既知の不安定性がテスト実行中に顕在化した直接的な証拠と見なせる。すなわち、Puppeteerがテスト対象ページへのナビゲーションを開始する瞬間、拡張機能のSWがまだ完全に初期化・有効化されておらず、ナビゲーションイベントを捕捉してコンテンツスクリプトを注入するための準備が整っていない状態が発生している。このわずかなタイミングの逸失が、テスト全体の失敗につながっている。B. 問題のフレーミング：MV3テストにおける自動化のトリレンマこの問題は、MV3拡張機能のE2Eテストにおける「自動化のトリレンマ」として捉えることができる。すなわち、「テストの実行速度」「信頼性」「MV3ライフサイクルの短命性」という三つの要素が互いにトレードオフの関係にある。CI（継続的インテグレーション）パイプラインではテストの高速な実行が求められるが、その速度が仇となり、拡張機能のSWがインストールされ、有効化され、イベントリスナーをアタッチする前に、Puppeteerがページへ遷移してしまう。この結果、テストの信頼性が損なわれる。このトリレンマを特に深刻化させるのが、CI環境そのものの特性である。GitHub ActionsのようなCIランナーは、クリーンな仮想環境上で毎回ゼロからテストを実行する。これは、開発者のローカルマシンとは大きく異なる。ローカル環境では、プロファイルが永続化され、拡張機能が一度読み込まれれば、ある程度ウォームアップされた状態で次のテストが実行される。しかし、CI環境では毎回がコールドスタートであり、キャッシュされたリソースや事前に起動しているプロセスは存在しない。このため、SWのアクティベーションに伴うレイテンシがより顕著になり、競合状態が発生する確率が格段に高まる 3。CI環境の高性能でクリーンな性質は、通常はテストの再現性を高める利点となる。しかし、この文脈においては、Puppeteerのpage.goto()コマンドが、ブラウザ内部で非同期に行われる拡張機能の読み込みプロセスに対して相対的に速く実行されすぎるという事態を招く。この「速さ」が負債となり、ナビゲーションイベントが拡張機能の準備が整う前に発生し、結果としてテストの不安定性（flakiness）を増大させる主要因となっている。したがって、この問題の解決には、CI環境が競合状態を助長する「敵対者」として機能しうるという認識に基づいた、防御的なテスト戦略の構築が不可欠となる。II. Manifest V3 Service Workerのライフサイクル：短命性と予測不可能性のパラダイムA. 永続的なバックグラウンドページからの根本的な転換MV3アーキテクチャにおけるE2Eテストの不安定性を理解するためには、まずManifest V2（MV2）の永続的なバックグラウンドページとMV3のイベント駆動型Service Workerとの間の根本的な設計思想の違いを深く理解する必要がある。MV2のバックグラウンドページは、拡張機能が有効である限り、ブラウザのライフサイクルとほぼ連動して永続的に実行され続けた。これにより、グローバル変数に状態を保持し、いつでも即座に応答できるという、予測可能で安定した実行環境が提供されていた。対照的に、MV3のSWはリソース効率を最大化するために設計されており、本質的に短命（ephemeral）である 5。SWは特定のイベント（ツールバーアイコンのクリック、API呼び出し、特定のナビゲーションイベントなど）に応じて起動し、処理が完了して一定期間アイドル状態が続くと、ブラウザによって積極的に終了させられる。この設計は、ブラウザ全体のメモリ消費量やCPU負荷を削減する上で大きな利点があるが、開発者にとっては、SWが「常に存在し、いつでも応答可能」という前提を覆すパラダイムシフトを要求する。この予測不可能性こそが、競合状態の温床となる。B. アイドル終了と30秒のタイマーMV3のSWライフサイクルを支配する最も重要なルールの一つが、アイドル状態に基づく終了メカニズムである。公式ドキュメントによれば、SWは通常、以下のいずれかの条件を満たしたときにChromeによって終了させられる 7。30秒間の非アクティブ状態: イベントの受信や拡張機能APIの呼び出しがない状態が30秒続くと、アイドルタイマーが満了し、SWは終了する。5分以上の単一リクエスト処理: 一つのイベントやAPI呼び出しの処理に5分以上かかった場合。30秒以上のfetch()応答待ち: fetch()リクエストに対する応答が30秒以内に到着しない場合。重要なのは、イベントの受信やAPI呼び出しがこのアイドルタイマーをリセットするという点である。しかし、一度終了したSWが次のイベントで再起動する際には、無視できないレイテンシが発生する。E2Eテストのシナリオにおいて、あるステップから次のステップまでの間に30秒以上の「待ち」や「無操作」期間が存在する場合、SWが終了している可能性を常に考慮しなければならない。このライフサイクルは、テスト設計と思想に根本的な変更を強いる。もはや、SWを永続的なプロセスと見なすことはできない。SWの可用性に依存するすべてのテストステップは、その実行直前にSWの存在と準備完了状態を確認する防御的なチェックを伴うべきである。特に、SW内のグローバル変数に状態を保存するアプローチは、SWが終了するとその状態がすべて失われるため、テストの不安定性を保証するアンチパターンとなる 6。一部では、setIntervalなどを用いて定期的にSWへメッセージを送信し、人為的にアクティブ状態を維持しようとする「キープアライブ」ハックが議論されることがある 8。しかし、これはMV3の設計思想に反する対症療法であり、根本的な解決策ではない。真の解決策は、SWの終了を前提とし、それに耐えうる（resilient）テストと拡張機能のアーキテクチャを設計することにある。テストは、SWがいつでも終了・再起動しうるという前提のもとで、状態をchrome.storage APIなどの永続的なストレージに保存し、各操作が自己完結的かつステートレスになるように構築されるべきである。C. 既知の活性化問題と「デッドモード」さらに問題を複雑にするのが、Chromiumで報告されているSWの活性化に関する既知のバグである。特定の条件下、特に自動化環境下において、SWが一度終了した後、次のイベントが発生しても正常に再起動せず、応答不能な「デッドモード」に陥ることがある 1。この状態は、拡張機能全体を手動で再読み込みするまで解消されない場合がある。この「デッドモード」の存在は、ユーザーの調査で試みられた「1回だけreload」という対策がなぜ不十分であったかを説明する。単一のリロードでは、タイミングが悪ければ、この根深いバグから回復できない可能性がある。これは、テストの不安定性が単なるタイミングの問題だけでなく、ブラウザ自体の実装の複雑さや潜在的な不具合にも起因していることを示唆している。したがって、E2Eテストの安定化戦略は、このような最悪のケースにも対処できる多層的な防御策を含む必要がある。III. 戦略的介入：テスト環境を安定化させるための多層的アプローチ問題の根本原因がMV3のライフサイクルとテスト自動化の間のタイミングのずれにあることを踏まえ、解決策は単一の修正ではなく、複数の層にわたる戦略的な介入を必要とする。ここでは、即時対応可能なテストランナーの強化から、より堅牢なアーキテクチャ変更までを段階的に示す。フェーズ1：テストランナーの初期化シーケンスの要塞化（「インテリジェントな待機」フェーズ）最初の防衛線は、Puppeteerテストスクリプト自体を強化し、拡張機能が完全に準備完了するまでインテリジェントに待機させることである。1.1. 堅牢なService Workerの検出最も重要なステップは、SWが単に「存在する」だけでなく、「アクティブで応答可能」な状態になるまで確実に待機することである。これにはbrowser.waitForTarget()を使用するのが標準的な方法である 9。JavaScriptasync function waitForServiceWorker(browser, timeout = 60000) {
  try {
    const swTarget = await browser.waitForTarget(
      (target) => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'),
      { timeout }
    );
    const worker = await swTarget.worker();
    if (!worker) {
      throw new Error('Service Worker target found, but worker instance is not available.');
    }
    return worker;
  } catch (error) {
    console.error('Service Worker not found or failed to activate within the timeout period.');
    throw error;
  }
}
この関数は、指定されたタイムアウト時間（CI環境では長めに設定することを推奨）内に、拡張機能に属するservice_workerタイプのターゲットが出現するのを待つ。1.2. about:blankによるプレウォーミング戦略これは、競合状態を解消するための非常に効果的で、しばしば見過ごされがちなテクニックである。テスト対象の実際のページにナビゲートする前に、まず新しいページを作成し、about:blankに遷移させる。これにより、拡張機能はページの読み込みという同時並行的なプレッシャーから解放され、自身のonInstalledイベントやアクティベーション処理を完了させるための、ニュートラルで安定した時間とコンテキストを得ることができる 11。この戦略の核心は、「拡張機能の読み込み」と「テストページのナビゲーション」という二つの非同期処理を分離・直列化することにある。manifest.json内の宣言的なcontent_scriptsは、拡張機能がブラウザに完全に登録された 後 に行われるナビゲーションに対してのみ有効である。about:blankへのナビゲーションはコンテンツスクリプトの注入をトリガーしないため、拡張機能は安全にセットアップを完了できる。SWの準備が整ったという明確なシグナルを受け取った後で初めて、実際のテストURLへのナビゲーションを行うことで、拡張機能がナビゲーションイベントを確実に捕捉できる状態を保証する。JavaScript// In your test setup (e.g., beforeEach)
const browser = await puppeteer.launch({...});
const page = await browser.newPage();
await page.goto('about:blank'); // Pre-warming step

// Now, wait for the service worker to be fully ready
const serviceWorker = await waitForServiceWorker(browser);

// Proceed to the actual test page
// await page.goto(TEST_URL); // This is now safe
1.3. 準備完了状態のプロービングwaitForTarget()でSWのターゲットを見つけただけでは、まだ完全に応答可能な状態であるとは断定できない。より確実な準備完了のシグナルを得るために、SWのコンテキスト内で簡単なコードを実行して「プローブ（探査）」する。JavaScript// Inside waitForServiceWorker, or as a separate readiness check
async function probeServiceWorker(worker) {
  try {
    await worker.evaluate(() => true);
    console.log('Service Worker is responsive.');
    return true;
  } catch (error) {
    console.error('Service Worker is not responsive:', error);
    return false;
  }
}

// Usage after getting the worker
const serviceWorker = await waitForServiceWorker(browser);
await probeServiceWorker(serviceWorker);
worker.evaluate(() => true)が成功裏に解決されれば、SWが単に存在するだけでなく、アクティブにリクエストを処理できる状態にあることが確認できる。これは、waitForTarget単独よりもはるかに信頼性の高い準備完了の指標となる。フェーズ2：回復力のあるコンテンツスクリプト注入戦略の設計（「決定論的な注入」フェーズ）テストランナーの準備が整ったら、次にコンテンツスクリプトの注入プロセスそのものの信頼性を高める。2.1. 注入手法の比較分析現在、コンテンツスクリプトを注入するには複数の方法があり、それぞれに利点と欠点が存在する。E2Eテストの文脈で最適な手法を選択するために、以下の比較表を参考にする。手法実行タイミングService Workerへの依存E2Eテストにおける信頼性主なユースケースmanifest.json (content_scripts)宣言的（ナビゲーション時）初期注入には不要中〜低（競合状態に脆弱）静的な注入、基本的なケースchrome.scripting.registerContentScriptsプログラム的（ナビゲーション/イベント時）登録/解除にSWが必須中（SWのイベントリスナーに依存）動的なルールに基づく注入chrome.scripting.executeScript (SWから)プログラム的（イベント時）SWがアクティブである必要あり高（SWがアクティブなら信頼性高い）拡張機能のイベントに応じた注入chrome.scripting.executeScript (テストランナーから)プログラム的（オンデマンド）SWがアクティブである必要あり決定的（最高）E2Eテストでの強制的な状態注入2.2. 最終手段：テストランナーからのプログラム的注入E2Eテストにおいて最高の信頼性を追求するためには、拡張機能自身の内部的な注入ロジック（manifest.jsonやwebNavigationリスナー）をバイパスし、Puppeteerテストスクリプトから直接SWに命令して、コンテンツスクリプトをオンデマンドで注入する方法が最も効果的である。このアプローチの鍵は、テストスクリプトが単なる受動的な観測者（注入が起こるのを待つ）から、能動的なオーケストレーター（注入を発生させる）へと役割を変える点にある。これにより、タイミングに依存するすべての不確実性が排除され、テストは完全に決定的（deterministic）になる。実装には、フェーズ1で取得したworkerオブジェクトと、Puppeteerページから取得したタブIDが必要になる。JavaScriptasync function forceInjectContentScript(page, worker) {
  const cdpSession = await page.target().createCDPSession();
  const { targetInfos } = await cdpSession.send('Target.getTargets');
  const pageTargetInfo = targetInfos.find(info => info.targetId === page.target()._targetId);

  if (!pageTargetInfo ||!pageTargetInfo.targetId) {
    throw new Error('Could not determine the tab ID for the page.');
  }
  
  // Note: In many Puppeteer versions, the CDP targetId can be used as the tabId.
  // However, for full correctness, one might need more complex logic if this assumption fails.
  // For most cases, this is sufficient.
  const tabId = pageTargetInfo.targetId;

  await worker.evaluate(
    (tabId) => {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js'], // Path relative to extension root
      });
    },
    tabId
  );
  console.log(`Content script forcefully injected into tab ${tabId}.`);
}

// Usage in test
await page.goto(TEST_URL);
const serviceWorker = await waitForServiceWorker(browser);
await forceInjectContentScript(page, serviceWorker);

// Now, it's safe to wait for the UI element
await page.waitForSelector('[data-xt-id="xt-selection-button"]');
このコードは、worker.evaluate()を通じてSWのコンテキストでchrome.scripting.executeScript()を実行する 12。テストスクリプトが注入のタイミングを完全に制御するため、競合状態が発生する余地がなくなる。これは、不安定性を排除するための最も強力な手段である。フェーズ3：推奨されるPuppeteerの起動設定最後に、環境に応じた最適なPuppeteerの起動オプションを設定することが、安定したテスト基盤の構築に不可欠である。3.1. CI向け必須引数ローカルでのデバッグとGitHub Actions環境では、目的が異なるため、設定も変えるべきである。カテゴリフラグ/オプション説明ローカルデバッグ推奨値CI / GitHub Actions推奨値puppeteer.launch Optionheadlessブラウザをヘッドレスモードで実行するかどうか。false'new'puppeteer.launch OptionslowMo各操作を遅延させ、視覚的なデバッグを容易にする。50 (ms)0 (or undefined)puppeteer.launch Optiondevtools各タブでDevToolsを自動的に開く。truefalseChrome Argument--no-sandboxサンドボックスを無効化。LinuxベースのCI環境で必須。不要'--no-sandbox'Chrome Argument--disable-setuid-sandboxsetuidサンドボックスを無効化。--no-sandboxと併用。不要'--disable-setuid-sandbox'Chrome Argument--disable-dev-shm-usage/dev/shmの使用を無効化。Docker環境でのメモリ問題を回避。不要'--disable-dev-shm-usage'Chrome Argument--load-extension指定されたパスから非圧縮の拡張機能を読み込む。'./path/to/extension''./path/to/extension'Chrome Argument--disable-extensions-except指定された拡張機能以外をすべて無効化する。'./path/to/extension''./path/to/extension'特に重要なのは、CI環境でのheadless: 'new'の指定である。古いヘッドレスモードは拡張機能のサポートに制限があったため、新しいモードの使用が強く推奨される 15。また、--no-sandbox関連のフラグは、特権のないユーザーでプロセスを実行するLinuxベースのCIランナーでは必須である 3。IV. 高度な診断：ヘッドレスCI環境における完全な可観測性の実現A. 沈黙するService Workerの課題問題のデバッグを困難にしている一因は、SWからの診断情報が不足していることである。Puppeteerの標準的なpage.on('console')リスナーは、ページのコンテキスト（window）からのコンソール出力のみを捕捉する。これは、SWのグローバルスコープで実行されるconsole.log（例えば、e2e-settings.jsonの読み込みログ）を完全に無視してしまう。SWはページとは別の、隔離された実行コンテキストであるため、この「沈黙」は当然の結果である。B. 決定的な解決策：CDPセッションを介したSWログの捕捉この可観測性のギャップを埋めるためには、低レベルのChrome DevTools Protocol（CDP）を直接利用して、SWの実行コンテキストにリスナーをアタッチする必要がある。これにより、SW内部で発生するすべてのコンソール出力を捕捉し、CIのログに出力することが可能になる。このアプローチの核心は、ブラウザを単一のエンティティとしてではなく、ページ、iframe、SWといった独立した実行コンテキストの集合体として捉えることにある。適切なコンテキストにリスナーをアタッチすることこそが、効果的なデバッグの鍵となる。JavaScript// This function sets up listeners for all future service workers
function captureServiceWorkerLogs(browser) {
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'service_worker') {
      try {
        const cdpSession = await target.createCDPSession();
        await cdpSession.send('Runtime.enable');
        
        cdpSession.on('Runtime.consoleAPICalled', (event) => {
          const logArgs = event.args.map(arg => {
            if (arg.unserializableValue) {
              return arg.unserializableValue;
            }
            return arg.value;
          });
          console.log(``,...logArgs);
        });

        console.log('Attached console listener to a new Service Worker.');
      } catch (error) {
        console.error('Failed to attach to service worker target:', error);
      }
    }
  });
}

// Usage at the beginning of your test setup
const browser = await puppeteer.launch({...});
captureServiceWorkerLogs(browser);
このコードは、browser.on('targetcreated')を用いて新しいターゲットの作成を監視する。service_workerタイプのターゲットが作成された際に、そのターゲットへのCDPセッションを確立し、Runtimeドメインを有効化する。そして、Runtime.consoleAPICalledイベントをリッスンすることで、SWからのすべてのコンソールメッセージ（log, warn, errorなど）を捕捉し、CIの標準出力にプレフィックス付きで表示する 18。これにより、e2e-settings.jsonが正しく読み込まれ、baseUrlが上書きされているかどうかの直接的な証拠を得ることができる。C. CIアーティファクトのベストプラクティスデバッグ効率を最大化するため、GitHub Actionsのワークフローを以下のように設定し、テスト失敗時に包括的なアーティファクトをアップロードすることを推奨する 3。統合コンソールログ: Node.jsのテストランナー、ページのコンテキスト、そしてSWのコンテキストからのログを、それぞれ明確なプレフィックス（例：, `[PAGE]`, ）を付けて一つのファイルに集約する。失敗時点のスクリーンショット: タイムアウトやアサーション失敗が発生した瞬間のスクリーンショットを保存する。Puppeteerトレース: Puppeteerのトレース機能を有効にし、失敗したテストのパフォーマンスやイベントのタイムラインを後から分析できるようにする。YAML#.github/workflows/e2e-tests.yml
- name: Upload artifacts on failure
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: e2e-test-artifacts
    path: |
     ./e2e-logs.txt
     ./failure-screenshot.png
     ./trace.json
これらのアーティファクトは、CI上で発生した再現の難しい問題をローカルでデバッグする際の、非常に価値のある情報源となる。V. 包括的な推奨事項と実装ロードマップこれまでの分析に基づき、観測されているE2Eテストの不安定性を解消するための、優先順位付けされた具体的なアクションプランを以下に示す。A. 即時対応（低労力・高インパクト）これらの対策は、比較的少ない労力で実装可能でありながら、テストの安定性に大きな改善をもたらすことが期待できる。Puppeteer起動設定の更新: フェーズ3で提示した、CI環境向けの推奨起動引数（headless: 'new', --no-sandbox等）をpuppeteer.launchオプションに即時適用する。about:blankプレウォーミング戦略の導入: すべてのE2Eテストのセットアップ処理の冒頭で、about:blankページへのナビゲーションを追加し、拡張機能の初期化とページの読み込みを分離する。堅牢なwaitForServiceWorkerユーティリティの実装: フェーズ1で示した、タイムアウト付きのSW待機関数と、worker.evaluate()による準備完了プローブを導入し、SWが応答可能になるまで確実に待機する。B. アーキテクチャの改良（中労力・最大信頼性）これらの対策は、テストコードや拡張機能の構造に一部変更を要するが、不安定性の根本原因を排除し、最大限の信頼性を確保するために不可欠である。テストランナーからのプログラム的注入へのリファクタリング: E2Eテストにおけるコンテンツスクリプトの読み込み方法を、テストランナーがworker.evaluate()経由でchrome.scripting.executeScript()を呼び出す方式に切り替える。これを主要な注入メカニズムとし、競合状態を構造的に排除する。高度なSWログ捕捉メカニズムの実装: フェーズ4で示したCDPセッションを利用したSWログ捕捉機能を導入し、CI環境におけるデバッグ能力と可観測性を飛躍的に向上させる。C. 長期的なベストプラクティス将来的な安定性と保守性を確保するために、以下のプラクティスを継続的に実践する。SWのグローバル状態への依存の見直し: 拡張機能のコードをレビューし、SWのグローバル変数に依存している箇所を特定する。可能な限り、状態管理をchrome.storage APIを利用した永続ストレージに移行し、SWがいつ終了しても状態が失われない設計を目指す。ステートレスで回復力のあるテストの設計: すべてのテストケースが、前のテストの状態に依存せず、独立して実行可能であることを保証する。また、テストの各ステップが、SWの終了と再起動を許容できるように設計されていることを確認する。
