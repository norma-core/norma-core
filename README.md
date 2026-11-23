# NormaCore

### The Unified Toolkit for Physical System Development & Operations

**NormaCore** is a unified toolkit designed to facilitate the development and deployment of physical systems. From complex robotics to distributed sensor networks and hobby projects, the system provides a solid foundation to manage them all. To achieve this goal, the platform combines a unified API, high-performance data pipelines, and visual tooling to help you build and manage your entire ecosystem as one.

**Developer experience sits at the heart of our design philosophy.**

To fully realize the potential of this approach, we had to build a lot from scratch, rethinking traditional solutions from a practical perspective. This includes not just software, but complete hardware systems like our **7+1 DoF robotic arm** with a **parallel jaw gripper** - tools designed to open up a whole new dimension of applications for home and research robotics without significant cost or investment.

## What's inside

| Project | Path | Description |
|---|---|---|
| **ElRobot** | [`hardware/elrobot/`](hardware/elrobot/) | Fully 3D-printed 7+1 DoF robotic arm for imitation learning |
| **Parallel Jaw Gripper** | [`hardware/pgripper/`](hardware/pgripper/) | Modular gripper for the SO-101 arm |
| **Lamp** | [`hardware/lamp/`](hardware/lamp/) | Fully 3D-printed 5 DoF robotic desk lamp with an optional LED ring and web UI |
| **Station** | [`software/station/bin/station/`](software/station/bin/station/) | Real-time robotics platform — data collection, inference, control. Single binary, web UI |
| **SmolVLA fine-tune** | [`software/ai/smolvla_py/`](software/ai/smolvla_py/) | Train + deploy a [SmolVLA](https://huggingface.co/docs/lerobot/smolvla) policy on the SO-101 arm |
| **Gremlin** | [`shared/gremlin_go/`](shared/gremlin_go/) · [`shared/gremlin_py/`](shared/gremlin_py/) | High-performance Protobuf SDK for Go and Python — used across the station + drivers stack |

**Website:** [normacore.dev](https://normacore.dev)

**Follow us:**
- 🐦 [X/Twitter](https://x.com/norma_core_dev)
- 🎥 [YouTube](https://www.youtube.com/@normacoredev)
- 💼 [LinkedIn](https://www.linkedin.com/company/normacore/)
- 📢 [Reddit](https://www.reddit.com/r/NormaCore/)

**Join & Contribute:**
- 💬 [Discord](https://discord.gg/Z4Ytw3QfHP) - Chat with the community
- 🐙 [GitHub](https://github.com/norma-core/norma-core) - Source code & issues
