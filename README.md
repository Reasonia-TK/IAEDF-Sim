# KTC model IEDF/IADF Simulator Webアプリ

`bkm_1d_sheath_tpmc.ipynb` / `bkm_2d_wafer_edge_ring_tpmc.ipynb` の検証済み物理モデルを
そのまま抽出したWebアプリケーション。Linuxサーバー上のDockerで起動し、LAN内のブラウザから
IEDF・符号付きIADF・IAEDFのシミュレーションを実行・閲覧・比較できる。

## 機能

- **実行**: 1D（シースTPMC）/ 2D（ウェハ+エッジリング）のパラメータフォーム
  （日本語ラベル・ツールチップ・入力バリデーション・計算時間目安付き）。
  駆動波形は正弦波またはCSVアップロード（sha256で重複排除しDBに永続化）で、
  実行前に波形プレビューと2D形状プレビューを確認できる
- **ジョブ管理**: 非同期実行（子プロセス）、進捗表示、キャンセル、同時実行数制御
- **履歴**: 全計算をSQLite内部DBに記録（自動削除なし）。モデル・状態・ラベルで
  絞り込み検索。詳細画面で保存済みデータから全プロットを再描画、設定の再利用も可能
- **2Dスケッチ（ジオメトリv2）**: 非周期領域（左右壁=鏡像対称境界）の表面
  プロファイルをSVGエディタで編集。制御点ドラッグ・ダブルクリック追加・
  右クリック削除に加え、**セグメントをクリックして境界材質を明示指定**できる:
  ウェハ電位（Dirichlet）/ エッジリング電位（Dirichlet）/ 絶縁（非帯電誘電体、
  電位固定なし・粒子は吸収記録）。プリセット・数値テキスト同期付き。
  旧周期ジオメトリ設定は読み込み時に自動変換される
- **コレクタ**: 2Dの結果詳細画面で任意x範囲のIEDF/IADFを**実行後に何度でも**集計
  （保存済み全粒子データから即時計算）。フラックス図からのドラッグ範囲選択、
  ジョブへの定義保存、統計表、CSVダウンロード対応
- **比較**: 複数ジョブのIEDF/IADF重ね描き（最大値正規化オプション）と設定差分テーブル
- **プロット強化**: IEDFピーク自動検出とΔE表示（Riley見積もりとの比較付き）、
  レンジスライダー、Plotly標準のPNG保存
- **進捗・通知**: 実行中ジョブのログ表示（2D空間電荷収束履歴など）、完了トースト通知
- **モデル解説ページ**: 物理方程式（KCL・Child則・moving front・TPMC衝突・
  Laplace 3基底・空間電荷Poisson）をKaTeX数式で解説（`physics.html`、オフライン動作）
- **検証**: ノートブックと同じ数値検証（エネルギー保存・KCL残差・衝突確率など）を
  ジョブごとに実行し合否表示
- **管理者権限**: 削除に加え、**2Dモデルは計算の実行・結果の閲覧とも管理者限定**
  （BKM_ADMIN_PASSWORDによるBearer認証。非管理者には履歴一覧・詳細・比較・
  ダウンロードのすべてで2Dが見えない。GUIでも管理者ログイン時のみ2Dを表示）。
  削除は論理削除（DB記録・監査ログは残し、結果ファイルのみ物理削除）

## Dockerでの起動（Linuxサーバー）

```bash
cd app
BKM_ADMIN_PASSWORD='任意の管理者パスワード' docker compose up -d --build

# ポートが埋まっている場合は BKM_PORT で公開ポートを変更できる
BKM_PORT=8010 BKM_ADMIN_PASSWORD='...' docker compose up -d --build
```

- LAN内のブラウザから `http://<サーバーIP>:8000/`（`BKM_PORT`指定時はそのポート）へアクセス
- 計算結果は `./storage/results`、DBは `./storage/db` に永続化される
- 同時実行ジョブ数は `BKM_MAX_WORKERS`（既定2）で調整
- ファイアウォールでポート8000のLAN内許可が必要な場合がある

### トラブルシューティング（Linuxサーバー）

`unable to get image 'iaedf-sim-bkm'` のようなエラーは、Dockerデーモンへ
接続できないときに出る（イメージ名はフォルダ名から自動生成される正常な名前）。
エラーの続きの文言で切り分ける:

| 続きの文言 | 原因と対処 |
|---|---|
| `permission denied ... docker.sock` | `sudo usermod -aG docker $USER` して再ログイン（または `sudo docker compose ...`） |
| `Cannot connect to the Docker daemon` | `sudo systemctl enable --now docker` |
| `'compose' is not a docker command` | `sudo apt install docker-compose-plugin` |

## Windowsでの起動

**方法1: Docker Desktop** — Linuxと同じ `docker compose` コマンドがそのまま使える。

**方法2: ネイティブ起動（Docker不要、Python 3.12が必要）**

```powershell
cd app
.\start-windows.ps1 -Port 8010 -AdminPassword "任意のパスワード"
```

- 初回実行時に仮想環境の作成と依存インストールを自動で行う
- 起動時にLAN内向けURL（`http://<このPCのIP>:<Port>/`）を表示する
- LANに公開する場合はWindowsファイアウォールで該当ポートの受信許可が必要
- 停止は Ctrl+C。結果は `app/results/`、DBは `app/db/` に保存される

## ローカル開発（Windows/Linux共通）

```bash
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements.txt pytest httpx   # Windows
cd backend
../.venv/Scripts/python -m uvicorn api.main:app --port 8000
```

### テスト

```bash
cd backend
python -m pytest tests -m "not slow"   # 高速テスト（物理スモーク + API結合）
python -m pytest tests -m slow         # ノートブック一致検証（1Dフル実行 約40s）
```

slowテストは既定設定・既定シードでノートブックの実行済み出力と比較し、
到達数・脱出数・CX率レベルまでの数値一致を確認する。

## 構成

```
app/
├─ backend/
│  ├─ bkmcore/      # 物理コア（ノートブックから抽出、フレームワーク非依存）
│  ├─ api/          # FastAPI + SQLite + ジョブマネージャ
│  └─ tests/
├─ frontend/        # 静的SPA（Plotlyローカル同梱、ビルド不要）
├─ data/            # 断面積CSV・サンプル波形
├─ storage/         # Dockerボリューム（results/db）
└─ Dockerfile / docker-compose.yml
```

## 主要API

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/defaults/{1d,2d}` | 既定設定（ノートブックと同値） |
| POST | `/api/waveforms` | 波形CSVアップロード |
| POST | `/api/jobs` | ジョブ投入 `{model, label, submitted_by, config}` |
| GET | `/api/jobs` | 履歴一覧（model/status/q/limit/offset） |
| GET | `/api/jobs/{id}` | 状態・進捗・設定・検証 |
| GET | `/api/jobs/{id}/plots` | プロット用JSON |
| GET | `/api/jobs/{id}/download/{npz,config,plots}` | ダウンロード |
| POST | `/api/jobs/{id}/cancel` | キャンセル |
| DELETE | `/api/jobs/{id}` | 論理削除（**管理者のみ**、Bearer認証） |
| GET | `/api/compare?ids=a,b` | 複数ジョブ比較（設定diff付き） |
| GET | `/api/audit` | 監査ログ（管理者のみ） |

## 適用限界

物理モデルの適用限界はノートブック末尾の「適用限界と調整の目安」に準じる
（規定電場近似ΔE誤差±16%、二次電子・電子慣性なし、など）。
