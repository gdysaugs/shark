type GuestIntroProps = {
  mode: 'image' | 'video'
  onSignIn: () => void
}

import './guest-intro.css'

const HERO_BANNER_IMAGE = '/media/shark-hero-banner-20260314.png?v=20260314-2'
const HERO_BANNER_VIDEO = '/media/hero-banner-sharkai-video-2.mp4?v=20260323-1'
const VIDEO_6S = '/media/landing-sample-6s.mp4?v=20260316-1'
const VIDEO_8S = '/media/landing-sample-8s.mp4?v=20260314-1'
const VIDEO_10S = '/media/landing-sample-10s-v2.mp4?v=20260315-1'
const EDIT_CUCUMBER_SOURCE = '/media/edit-cucumber-source.avif?v=20260314-1'
const EDIT_CUCUMBER_RESULT = '/media/edit-cucumber-result.png?v=20260314-1'
const VIDEO_GENERATION_SAMPLES = [
  { src: VIDEO_6S, label: '6秒' },
  { src: VIDEO_8S, label: '8秒' },
  { src: VIDEO_10S, label: '10秒' },
] as const

export function GuestIntro({ mode, onSignIn }: GuestIntroProps) {
  const isVideoMode = mode === 'video'

  return (
    <div className='clean-home'>
      <header className='clean-nav'>
        <div className='clean-nav__brand'>
          <strong>SharkAI</strong>
          <span>Cloud Video Studio</span>
        </div>
        <img className='clean-nav__badge' src={HERO_BANNER_IMAGE} alt='SharkAI banner' loading='lazy' />
      </header>

      <section className='clean-hero'>
        <div className='clean-hero__intro'>
          <h1>{isVideoMode ? '画像→動画を一瞬で' : '2枚の画像で、高品質な編集結果を生成'}</h1>
          <div className='clean-hero__media-login'>
            <div className='clean-hero__banner-wrap clean-hero__banner-wrap--single-video' aria-label='SharkAIバナー動画'>
              <video
                className='clean-hero__banner-video'
                src={HERO_BANNER_VIDEO}
                autoPlay
                loop
                muted
                playsInline
                preload='metadata'
              />
            </div>
            <div className='clean-hero__pitch'>
              <p>高品質な動画生成と画像編集を1つの画面で</p>
              <p>４種類の独自動画モデル</p>
              <p>最大10秒の動画生成</p>
              <p>無料登録で5回生成可能</p>
              <div className='clean-hero__cta'>
                <button type='button' className='clean-btn clean-btn--primary clean-btn--hero' onClick={onSignIn}>
                  ログイン/無料登録
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className='clean-samples clean-samples--video clean-generation-showcase'>
        <header className='clean-section__head clean-section__head--tight'>
          <h2>動画生成サンプル</h2>
        </header>
        <div className='clean-video-grid clean-video-grid--generation'>
          {VIDEO_GENERATION_SAMPLES.map((sample) => (
            <article key={sample.src} className='clean-card'>
              <header>
                <strong>{sample.label}サンプル</strong>
                <span>動画生成出力</span>
              </header>
              <video src={sample.src} autoPlay loop muted playsInline preload='metadata' />
            </article>
          ))}
        </div>
      </section>

      <section className='clean-samples clean-edit-showcase'>
        <header className='clean-section__head clean-section__head--tight'>
          <h2>画像編集サンプル</h2>
          <p>どんな画像もプロンプトで自由に改変できます。</p>
        </header>
        <div className='clean-edit-grid'>
          <article className='clean-card clean-edit-card'>
            <header>
              <strong>元画像</strong>
            </header>
            <img src={EDIT_CUCUMBER_SOURCE} alt='画像編集の元画像' loading='lazy' />
          </article>

          <div className='clean-edit-prompt'>
            <span>追加プロンプト</span>
            <strong>女がキュウリを食べる</strong>
            <p>この指示を加えて画像を生成</p>
          </div>

          <article className='clean-card clean-edit-card'>
            <header>
              <strong>編集後</strong>
            </header>
            <img src={EDIT_CUCUMBER_RESULT} alt='画像編集後の結果' loading='lazy' />
          </article>
        </div>
      </section>

      <section className='clean-samples clean-feature-showcase'>
        <header className='clean-section__head clean-section__head--tight'>
          <h2>SharkAIの機能一覧</h2>
          <p>動画と画像をまとめて扱える主要機能</p>
        </header>
        <div className='clean-feature-grid'>
          <article className='clean-feature-card'>
            <span className='clean-feature-icon' aria-hidden='true'>
              🎬
            </span>
            <div>
              <strong>4つの独自動画モデル</strong>
              <p>V1からV4まで独自にチューニングした4つの動画生成モデルを使用可能。</p>
            </div>
          </article>

          <article className='clean-feature-card'>
            <span className='clean-feature-icon' aria-hidden='true'>
              ⏱️
            </span>
            <div>
              <strong>最大10秒の動画生成</strong>
              <p>最大10秒までの動画生成に対応し、用途に合わせて長さを選択可能。</p>
            </div>
          </article>

          <article className='clean-feature-card'>
            <span className='clean-feature-icon' aria-hidden='true'>
              🖼️
            </span>
            <div>
              <strong>画像編集モード</strong>
              <p>画像1枚を必須に、追加画像も使いながらプロンプトで見た目を編集可能。</p>
            </div>
          </article>

          <article className='clean-feature-card'>
            <span className='clean-feature-icon' aria-hidden='true'>
              ⚡
            </span>
            <div>
              <strong>実運用向けワークフロー</strong>
              <p>トークン管理、出力保存、日次ボーナスなどの運用機能を標準搭載。</p>
            </div>
          </article>
        </div>
      </section>

      <section className='clean-howto-cta-section'>
        <div className='clean-howto-cta'>
          <button type='button' className='clean-btn clean-btn--primary clean-btn--hero' onClick={onSignIn}>
            無料登録で５トークンもらう
          </button>
        </div>
      </section>

      <section className='clean-samples clean-terms-block'>
        <header className='clean-section__head clean-section__head--tight'>
          <h2>利用規約・禁止事項</h2>
          <p>安全と権利保護のため、以下の条件に同意した場合のみ利用できます。</p>
        </header>

        <div className='clean-terms-grid'>
          <article className='clean-terms-card'>
            <h3>著作権・商標権の侵害禁止</h3>
            <ul>
              <li>第三者の著作物（画像・動画・音声・ロゴ・BGM・台本等）を無断で入力・生成・再配布する行為を禁止します。</li>
              <li>権利者の許諾がない素材を使った商用利用、販売、配信、広告利用を禁止します。</li>
              <li>他者の作品を本サービスで改変し、自作として公開する行為を禁止します。</li>
            </ul>
          </article>

          <article className='clean-terms-card'>
            <h3>肖像権・パブリシティ権の侵害禁止</h3>
            <ul>
              <li>本人同意なく、他人の顔・声・氏名・芸名・キャラクター性を利用する行為を禁止します。</li>
              <li>実在人物になりすました動画・音声の作成、誤認を招く投稿、名誉を損なう利用を禁止します。</li>
              <li>公人・著名人を含め、権利侵害または誤解誘導となる利用を禁止します。</li>
            </ul>
          </article>

          <article className='clean-terms-card'>
            <h3>他人素材の無断利用禁止</h3>
            <ul>
              <li>他人の画像・音声・動画・アバターを、許可なくアップロードまたは学習用途に使う行為を禁止します。</li>
              <li>漏えいデータ、違法取得データ、スクレイピングした個人データの利用を禁止します。</li>
              <li>第三者のプライバシー情報（住所・連絡先・勤務先等）を含む素材の取り扱いを禁止します。</li>
            </ul>
          </article>

          <article className='clean-terms-card'>
            <h3>児童・未成年に関する厳格禁止</h3>
            <ul>
              <li>児童・未成年を対象とした性的表現、性的示唆、搾取的表現、年齢不詳で未成年に見える表現を全面禁止します。</li>
              <li>未成年の声・容姿を模倣した性的コンテンツ、出会い・勧誘・誘導につながる利用を禁止します。</li>
              <li>法令・ガイドラインに抵触する可能性がある場合、即時停止・通報・記録保全の対象となります。</li>
            </ul>
          </article>

          <article className='clean-terms-card'>
            <h3>違法・有害利用の禁止</h3>
            <ul>
              <li>脅迫、詐欺、誹謗中傷、ヘイト、差別、暴力扇動、選挙・世論の不正操作に関わる利用を禁止します。</li>
              <li>マルウェア配布、認証回避、不正アクセス補助、なりすまし営業などの不正行為を禁止します。</li>
              <li>医療・法律・金融など高リスク領域で、虚偽情報を断定的に拡散する行為を禁止します。</li>
            </ul>
          </article>

          <article className='clean-terms-card'>
            <h3>違反時の対応</h3>
            <ul>
              <li>規約違反が確認された場合、生成停止、アカウント制限、トークン失効、データ削除を行います。</li>
              <li>重大または反復違反は、事前通知なく永久停止および関係機関への通報対象となる場合があります。</li>
              <li>利用者は、必要な権利処理と法令遵守を自己責任で行うものとします。</li>
            </ul>
          </article>
        </div>

        <p className='clean-terms-note'>
          本サービスを利用した時点で、上記禁止事項および適用法令の遵守に同意したものとみなします。
        </p>
      </section>
    </div>
  )
}
