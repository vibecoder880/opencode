<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Trợ lý lập trình AI mã nguồn mở với hỗ trợ OC Kit.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/vibecoder880/opencode/actions"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/vibecoder880/opencode/typecheck.yml?style=flat-square&branch=main" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

---

## Giới thiệu

Đây là bản fork của [OpenCode](https://github.com/anomalyco/opencode) với **OC Kit** được thêm vào. OC Kit là hệ thống quản lý gói cho các AI agent, cho phép bạn cài đặt, cập nhật và quản lý các gói kỹ năng tái sử dụng.

### Tính năng mới trong bản fork này

- **OC Kit Package Manager** - Cài đặt, cập nhật, xác thực và quản lý các gói kỹ năng AI agent
- **Kit Packaging & Publishing** - Tạo và phân phối OC Kit của riêng bạn
- **Workflow Engine** - Định nghĩa và thực thi các quy trình AI đa bước
- **Hook System** - Chạy script tùy chỉnh trên các sự kiện vòng đời
- **Dependency Resolution** - Kit có thể phụ thuộc vào kit khác
- **Sandboxed Execution** - Chạy hook không tin cậy trong môi trường sandbox

---

## Cài đặt

### OpenCode

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Các trình quản lý gói (Package managers)
npm i -g opencode-ai@latest        # hoặc bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS và Linux (khuyên dùng, luôn cập nhật)
brew install opencode              # macOS và Linux (công thức brew chính thức, ít cập nhật hơn)
sudo pacman -S opencode            # Arch Linux (Bản ổn định)
paru -S opencode-bin               # Arch Linux (Bản mới nhất từ AUR)
mise use -g opencode               # Mọi hệ điều hành
nix run nixpkgs#opencode           # hoặc github:anomalyco/opencode cho nhánh dev mới nhất
```

> [!TIP]
> Hãy xóa các phiên bản cũ hơn 0.1.x trước khi cài đặt.

### OpenCode + OC Kit (Bản fork này)

Bản fork này đã tích hợp sẵn OC Kit. Cài một lần, dùng mọi thứ.

#### Cài đặt nhanh

```bash
# macOS / Linux / WSL
curl -fsSL https://raw.githubusercontent.com/vibecoder880/opencode/main/scripts/install.sh | bash

# Windows (PowerShell)
powershell -c "irm https://raw.githubusercontent.com/vibecoder880/opencode/main/scripts/install.ps1 | iex"
```

Sau đó chạy:
```bash
opencode
```

#### Cách khác: npm

```bash
npm install -g https://github.com/vibecoder880/opencode/releases/latest/download/opencode.tgz
```

#### Bạn nhận được gì

Sau khi cài đặt, bạn có mọi thứ:

```bash
opencode                    # Chạy OpenCode voi OC Kit
opencode kit list           # Liệt kê cac kit da cai
opencode kit install <id>   # Cai kit
opencode kit validate       # Xac thuc kit
opencode kit doctor         # Kiem tra suc khoe kit
opencode kit update         # Cap nhat kit
opencode kit pack           # Tao archive kit
opencode kit publish        # Xuat ban len GitHub
```

---

## Lệnh OC Kit

| Lệnh | Mô tả |
|-------|-------|
| `oc kit list` | Liệt kê các kit đã cài |
| `oc kit validate <target>` | Xác thực manifest kit |
| `oc kit install <source>` | Cài kit từ thư mục cục bộ |
| `oc kit update <kit-id>` | Cập nhật kit đã cài |
| `oc kit rollback <kit-id>` | Quay lại phiên bản trước |
| `oc kit doctor` | Kiểm tra sức khỏe các kit |
| `oc kit pack <source>` | Tạo archive kit (.tar.gz) |
| `oc kit publish <archive>` | Xuất bản kit lên GitHub release |
| `oc kit search <query>` | Tìm kit trên marketplace |
| `oc kit test <kit-id>` | Kiểm tra kit trước khi xuất bản |
| `oc kit init` | Khởi tạo kit mới từ template |
| `oc kit dev` | Hot reload khi phát triển kit |

### Cấu trúc Manifest Kit

```json
{
  "id": "my-kit",
  "name": "My Kit",
  "version": "1.0.0",
  "description": "Một kit AI agent tùy chỉnh",
  "min_opencode": "0.1.0",
  "skills": ["plan", "research"],
  "agents": ["analyst"],
  "workflows": ["research-flow"],
  "hooks": {
    "pre-commit": ["validate.sh"]
  },
  "dependencies": {
    "base-kit": "^1.0.0"
  }
}
```

### Cấu trúc thư mục Kit

```
my-kit/
├── kit.json              # Manifest (bắt buộc)
├── skills/               # Định nghĩa kỹ năng
│   ├── plan.md
│   └── research.md
├── agents/               # Hồ sơ agent
│   └── analyst.md
├── workflows/            # Định nghĩa quy trình
│   └── research.yaml
├── hooks/                # Script hook
│   └── pre-commit.sh
└── artifacts/            # Artifact tĩnh
    └── templates/
```

---

## Ứng dụng Desktop (BETA)

OpenCode cũng có sẵn dưới dạng ứng dụng desktop. Tải trực tiếp từ [trang releases](https://github.com/anomalyco/opencode/releases) hoặc [opencode.ai/download](https://opencode.ai/download).

| Nền tảng | Tải xuống |
|----------|-----------|
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg` |
| macOS (Intel) | `opencode-desktop-mac-x64.dmg` |
| Windows | `opencode-desktop-windows-x64.exe` |
| Linux | `.deb`, `.rpm`, hoặc `.AppImage` |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

---

## Agents (Đại diện)

OpenCode bao gồm hai agent được tích hợp sẵn mà bạn có thể chuyển đổi bằng phím `Tab`.

- **build** - Agent mặc định, có toàn quyền truy cập cho công việc lập trình
- **plan** - Agent chỉ đọc dùng để phân tích và khám phá mã nguồn
  - Mặc định từ chối việc chỉnh sửa tệp
  - Hỏi quyền trước khi chạy các lệnh bash
  - Lý tưởng để khám phá các codebase lạ hoặc lên kế hoạch thay đổi

Ngoài ra còn có một subagent **general** dùng cho các tìm kiếm phức tạp và tác vụ nhiều bước.
Agent này được sử dụng nội bộ và có thể gọi bằng cách dùng `@general` trong tin nhắn.

Tìm hiểu thêm về [agents](https://opencode.ai/docs/agents).

---

## Tài liệu

Để biết thêm thông tin về cách cấu hình OpenCode, [**hãy truy cập tài liệu của chúng tôi**](https://opencode.ai/docs).

### Tài liệu OC Kit

- [Tham chiếu Manifest Kit](./packages/opencode/src/ockit/manifest.ts)
- [Các kiểu Kit](./packages/opencode/src/ockit/types.ts)
- [Triển khai CLI](./packages/opencode/src/ockit/cli.ts)
- [Workflow Engine](./packages/opencode/src/ockit/workflow/)

---

## Đóng góp

Nếu bạn muốn đóng góp cho OpenCode, vui lòng đọc [tài liệu hướng dẫn đóng góp](./CONTRIBUTING.md) trước khi gửi pull request.

### Xây dựng trên nền tảng OpenCode

Nếu bạn đang làm việc trên một dự án liên quan đến OpenCode và sử dụng "opencode" như một phần của tên dự án, ví dụ "opencode-dashboard" hoặc "opencode-mobile", vui lòng thêm một ghi chú vào README của bạn để làm rõ rằng dự án đó không được xây dựng bởi đội ngũ OpenCode và không liên kết với chúng tôi dưới bất kỳ hình thức nào.

---

**Tham gia cộng đồng của chúng tôi** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
