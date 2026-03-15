type GuestIntroProps = {
  mode: 'image' | 'video'
  onSignIn: () => void
}

import './guest-intro.css'

const HERO_BANNER_IMAGE = '/media/shark-hero-banner-20260314.png?v=20260314-2'
const HERO_SUB_BANNER_IMAGE = '/media/hero-sub-banner-20260314.png?v=20260314-1'
const VIDEO_6S = '/media/landing-sample-6s.mp4?v=20260316-1'
const VIDEO_8S = '/media/landing-sample-8s.mp4?v=20260314-1'
const VIDEO_10S = '/media/landing-sample-10s-v2.mp4?v=20260315-1'
const VIDEO_LIPSYNC_SAMPLE = '/media/landing-sample-lipsync-12.mp4?v=20260314-1'
const VIDEO_LIPSYNC_SAMPLE_POSTER = '/media/landing-sample-lipsync-12.jpg?v=20260314-2'
const LIPSYNC_HOWTO_SAMPLE = '/media/lipsync-howto-sample-11.mp4?v=20260314-1'
const LIPSYNC_HOWTO_SAMPLE_POSTER = '/media/lipsync-howto-sample-11.jpg?v=20260314-1'
const EDIT_CUCUMBER_SOURCE = '/media/edit-cucumber-source.avif?v=20260314-1'
const EDIT_CUCUMBER_RESULT = '/media/edit-cucumber-result.png?v=20260314-1'
const LIPSYNC_USER_SAMPLES = [
  {
    title: 'V1生成動画',
    video: '/media/lipsync-result-17.mp4?v=20260314-1',
    poster: '/media/lipsync-result-17.jpg?v=20260314-1',
  },
  {
    title: 'V2生成動画',
    video: '/media/lipsync-result-15.mp4?v=20260314-1',
    poster: '/media/lipsync-result-15.jpg?v=20260314-1',
  },
  {
    title: 'V3生成動画',
    video: '/media/lipsync-result-13.mp4?v=20260314-1',
    poster: '/media/lipsync-result-13.jpg?v=20260314-1',
  },
  {
    title: 'V4生成動画',
    video: '/media/lipsync-result-14.mp4?v=20260314-1',
    poster: '/media/lipsync-result-14.jpg?v=20260314-1',
  },
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
          <h1>{isVideoMode ? 'このAI、史上最強。' : '2枚の画像で、高品質な編集結果を生成'}</h1>
          <div className='clean-hero__media-login'>
            <div className='clean-hero__banner-wrap'>
              <img className='clean-hero__sub-banner' src={HERO_SUB_BANNER_IMAGE} alt='SharkAI hero banner' loading='lazy' />
            </div>
            <div className='clean-hero__pitch'>
              <p>最高峰の日本語リップシンク＆ボイスクローン</p>
              <p>４種類の独自動画モデル</p>
              <p>画像編集・動画生成どちらも対応</p>
              <div className='clean-hero__cta'>
                <button type='button' className='clean-btn clean-btn--primary clean-btn--hero' onClick={onSignIn}>
                  ログイン/無料登録
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className='clean-samples clean-samples--lipsync'>
        <div className='clean-video-grid clean-video-grid--lipsync'>
          {LIPSYNC_USER_SAMPLES.map((item) => (
            <article className='clean-card' key={item.video}>
              <header>
                <strong>{item.title}</strong>
              </header>
              <video src={item.video} poster={item.poster} controls playsInline preload='none' />
            </article>
          ))}
        </div>
      </section>

      <section className='clean-samples clean-samples--video'>
        <header className='clean-section__head clean-section__head--tight'>
          <h2>最大１０秒の動画生成</h2>
          <p>１枚の画像からどんな動画も作れます。</p>
        </header>
        <div className='clean-video-grid clean-video-grid--hero'>
          <article className='clean-card'>
            <header>
              <strong>6秒サンプル</strong>
              <span>最速で短い動画を作成</span>
            </header>
            <video src={VIDEO_6S} autoPlay loop muted playsInline preload='auto' />
          </article>
          <article className='clean-card'>
            <header>
              <strong>8秒サンプル</strong>
              <span>動きと安定感のバランス</span>
            </header>
            <video src={VIDEO_8S} autoPlay loop muted playsInline preload='auto' />
          </article>
          <article className='clean-card'>
            <header>
              <strong>10秒サンプル</strong>
              <span>演出重視の長尺動画</span>
            </header>
            <video src={VIDEO_10S} autoPlay loop muted playsInline preload='auto' />
          </article>
          <article className='clean-card'>
            <header>
              <strong>リップシンクサンプル(音量注意)</strong>
              <span>どんな動画にも好きなセリフを当てられます</span>
            </header>
            <video src={VIDEO_LIPSYNC_SAMPLE} poster={VIDEO_LIPSYNC_SAMPLE_POSTER} controls playsInline preload='none' />
          </article>
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
          <p>動画と音声をまとめて扱える主要機能</p>
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
              🎤
            </span>
            <div>
              <strong>日本語ボイスクローン</strong>
              <p>数秒の音声からコピーして、どんなセリフも自由に再現できる高精度クローン技術。</p>
            </div>
          </article>

          <article className='clean-feature-card'>
            <span className='clean-feature-icon' aria-hidden='true'>
              🔊
            </span>
            <div>
              <strong>幅広い感情表現</strong>
              <p>喘ぎ声や叫び声まで、ソース音声次第でどんな表現も可能。</p>
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

      <section className='clean-samples clean-lipsync-howto'>
        <header className='clean-section__head clean-section__head--tight'>
          <h2>リップシンクの使い方</h2>
          <p>4ステップで、人物動画に好きな声とセリフを当てられます。</p>
        </header>

        <ol className='clean-howto-steps'>
          <li className='clean-howto-step'>
            <span className='clean-howto-step__num'>1</span>
            <p>🎬 まず人物の映ってる動画を用意</p>
          </li>
          <li className='clean-howto-step'>
            <span className='clean-howto-step__num'>2</span>
            <p>🎤 ボイスクローンしたい音声または動画ファイルを用意（3〜10秒）</p>
          </li>
          <li className='clean-howto-step'>
            <span className='clean-howto-step__num'>3</span>
            <p>📝 セリフを入力</p>
          </li>
          <li className='clean-howto-step'>
            <span className='clean-howto-step__num'>4</span>
            <p>🗣️ 動画の人物がソースの声音でセリフをしゃべる！</p>
          </li>
        </ol>

        <article className='clean-card clean-howto-sample-card'>
          <header>
            <strong>リップシンク生成サンプル</strong>
            <span>実際の出力例</span>
          </header>
          <video
            src={LIPSYNC_HOWTO_SAMPLE}
            poster={LIPSYNC_HOWTO_SAMPLE_POSTER}
            controls
            playsInline
            preload='none'
          />
        </article>
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
