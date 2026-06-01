# Contador Pupunha

Aplicativo Android em Expo + React Native para gerenciar cargas, paletes e contagem de cabeças de pupunha com IA via Roboflow.

## Roboflow

O workflow publicado deve usar `Confidence = 0.15` no bloco do modelo. A API serverless atual recebe apenas a imagem como entrada, então esse threshold precisa ser salvo e publicado dentro do Roboflow.

## Rodar em desenvolvimento

```bash
npm install
npm start
```

## Gerar APK de teste

O build usa EAS Cloud. Faça login uma vez:

```bash
eas login
```

Depois gere o APK:

```bash
npm run build:apk
```

O EAS vai mostrar o link para baixar o arquivo `.apk` quando o build terminar.
