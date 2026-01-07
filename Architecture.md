## 1. 기본 아키텍처
``` mermaid
flowchart LR
  %% Clients
  subgraph E[Endpoints]
    WEB[Web]
    APP[Mobile App]
    SVC[Other Server]
  end

  %% Upload Server
  subgraph U[File Upload Server]
    API[Upload API]
    AUTH[Credential Manager]
    S3ADP[S3 Adapter]
    DAV[WebDAV Client]
  end

  %% Storage
  subgraph ST[Storage]
    S3[(Amazon S3)]
    NAS[(NAS)]
  end

  %% Request Flow
  WEB --> API
  APP --> API
  SVC --> API

  API --> AUTH
  API -->|S3 Route| S3ADP
  API -->|NAS Route| DAV

  AUTH -->|AWS Key Auth| S3ADP

  S3ADP -->|Upload Download| S3
  DAV -->|WebDAV Protocol| NAS

  S3 --> API
  NAS --> API

  API --> WEB
  API --> APP
  API --> SVC
```