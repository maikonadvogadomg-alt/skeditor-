import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface PwaCheckItem {
  id: string;
  label: string;
  status: "ok" | "fail" | "warn";
  detail: string;
  fix: string;
}

interface ManifestJson {
  name?: string;
  short_name?: string;
  start_url?: string;
  display?: string;
  icons?: Array<{ sizes?: string; src?: string; type?: string }>;
  theme_color?: string;
  background_color?: string;
}

router.get("/pwa-check", async (req, res) => {
  const rawUrl = (req.query["url"] as string | undefined) || "";
  const appUrl = rawUrl.trim();

  if (!appUrl) {
    res.status(400).json({ error: "Parâmetro url é obrigatório" });
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(appUrl);
  } catch {
    res.status(400).json({ error: "URL inválida. Use o formato: https://meu-app.replit.app" });
    return;
  }

  const base = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const results: PwaCheckItem[] = [];

  const httpsOk = parsedUrl.protocol === "https:";
  results.push({
    id: "https",
    label: "HTTPS",
    status: httpsOk ? "ok" : "fail",
    detail: httpsOk ? `Conexão segura via HTTPS ✅` : `O protocolo é ${parsedUrl.protocol}. PWA exige HTTPS.`,
    fix: httpsOk ? "" : "Publique o app via Replit Deploy ou outro host com HTTPS. O Replit Deploy já configura HTTPS automaticamente.",
  });

  let manifest: ManifestJson | null = null;
  let manifestUrl = "";
  try {
    const manifestRes = await fetch(`${base}/manifest.json`, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "PWA-Checker/1.0" },
    });
    if (manifestRes.ok) {
      manifest = await manifestRes.json() as ManifestJson;
      manifestUrl = `${base}/manifest.json`;
      results.push({
        id: "manifest",
        label: "manifest.json",
        status: "ok",
        detail: `Encontrado em ${manifestUrl}. Nome: "${manifest?.name || manifest?.short_name || "(sem nome)"}"`,
        fix: "",
      });
    } else {
      results.push({
        id: "manifest",
        label: "manifest.json",
        status: "fail",
        detail: `Não encontrado em ${base}/manifest.json (status ${manifestRes.status})`,
        fix: "Crie um arquivo manifest.json na pasta public/ do projeto. Peça para a Jasmim: \"Adicione um manifest.json PWA completo neste projeto.\"",
      });
    }
  } catch {
    results.push({
      id: "manifest",
      label: "manifest.json",
      status: "fail",
      detail: `Não foi possível acessar ${base}/manifest.json (timeout ou erro de rede)`,
      fix: "Verifique se o app está publicado e acessível. Crie o arquivo manifest.json na pasta public/ do projeto.",
    });
  }

  const hasName = !!(manifest?.name || manifest?.short_name);
  results.push({
    id: "manifest-name",
    label: "Nome do app no manifest",
    status: manifest === null ? "fail" : hasName ? "ok" : "fail",
    detail: manifest === null ? "Manifest não encontrado" : hasName ? `Nome definido: "${manifest.name || manifest.short_name}"` : "Campos name e short_name ausentes no manifest",
    fix: hasName ? "" : "Adicione \"name\" e \"short_name\" ao manifest.json. Ex: { \"name\": \"Meu App\", \"short_name\": \"MeuApp\" }",
  });

  const hasStartUrl = !!(manifest?.start_url);
  results.push({
    id: "manifest-start-url",
    label: "start_url no manifest",
    status: manifest === null ? "fail" : hasStartUrl ? "ok" : "warn",
    detail: manifest === null ? "Manifest não encontrado" : hasStartUrl ? `start_url: "${manifest.start_url}"` : "Campo start_url ausente — o browser usará / como padrão",
    fix: hasStartUrl ? "" : "Adicione \"start_url\": \"/\" ao manifest.json para garantir comportamento correto ao abrir o app.",
  });

  const hasDisplay = !!(manifest?.display);
  results.push({
    id: "manifest-display",
    label: "display mode no manifest",
    status: manifest === null ? "fail" : hasDisplay ? "ok" : "warn",
    detail: manifest === null ? "Manifest não encontrado" : hasDisplay ? `display: "${manifest.display}"` : "Campo display ausente — use \"standalone\" para modo app sem barra do navegador",
    fix: hasDisplay ? "" : "Adicione \"display\": \"standalone\" ao manifest.json para ocultar a barra de endereço.",
  });

  const icons = manifest?.icons || [];
  const has192 = icons.some(ic => (ic.sizes || "").includes("192"));
  const has512 = icons.some(ic => (ic.sizes || "").includes("512"));

  results.push({
    id: "icon-192",
    label: "Ícone 192×192px",
    status: manifest === null ? "fail" : has192 ? "ok" : "fail",
    detail: manifest === null ? "Manifest não encontrado" : has192 ? "Ícone 192×192 declarado no manifest ✅" : "Ícone 192×192 não encontrado no manifest",
    fix: has192 ? "" : "Adicione um arquivo PNG de 192×192px à pasta public/ e declare-o em manifest.json: { \"icons\": [{ \"src\": \"/icon-192.png\", \"sizes\": \"192x192\", \"type\": \"image/png\" }] }",
  });

  results.push({
    id: "icon-512",
    label: "Ícone 512×512px",
    status: manifest === null ? "fail" : has512 ? "ok" : "fail",
    detail: manifest === null ? "Manifest não encontrado" : has512 ? "Ícone 512×512 declarado no manifest ✅" : "Ícone 512×512 não encontrado no manifest",
    fix: has512 ? "" : "Adicione um arquivo PNG de 512×512px à pasta public/ e declare-o em manifest.json. Este ícone é obrigatório para a tela de splash e para gerar APK.",
  });

  let swFound = false;
  for (const swPath of ["/sw.js", "/service-worker.js", "/serviceWorker.js"]) {
    try {
      const swRes = await fetch(`${base}${swPath}`, {
        signal: AbortSignal.timeout(6000),
        headers: { "User-Agent": "PWA-Checker/1.0" },
      });
      if (swRes.ok) {
        const ct = swRes.headers.get("content-type") || "";
        if (ct.includes("javascript") || ct.includes("text")) {
          swFound = true;
          results.push({
            id: "service-worker",
            label: "Service Worker",
            status: "ok",
            detail: `Service worker encontrado em ${base}${swPath} ✅`,
            fix: "",
          });
          break;
        }
      }
    } catch {
      // continue to next path
    }
  }

  if (!swFound) {
    results.push({
      id: "service-worker",
      label: "Service Worker",
      status: "fail",
      detail: `Service worker não encontrado (verificado em /sw.js, /service-worker.js, /serviceWorker.js)`,
      fix: "Crie um arquivo sw.js na pasta public/ com o código mínimo de cache e registre-o no HTML. Peça para a Jasmim: \"Adicione um service worker neste projeto para suporte PWA.\"",
    });
  }

  const passed = results.filter(r => r.status === "ok").length;
  const total = results.length;
  const score = Math.round((passed / total) * 100);

  res.json({ url: appUrl, base, score, passed, total, items: results });
});

router.get("/twa-files", (req, res) => {
  const rawUrl = (req.query["url"] as string | undefined) || "";
  let appUrl = rawUrl.trim();
  if (!appUrl) appUrl = "https://SEU-APP.replit.app";

  let host = appUrl;
  try {
    host = new URL(appUrl).hostname;
  } catch {
    host = appUrl.replace(/^https?:\/\//, "").split("/")[0];
  }

  const packageName = "app." + host.replace(/-/g, "_").replace(/\./g, "_").toLowerCase();

  const files: Record<string, string> = {
    "README.md": `# Pacote Android TWA — ${host}

## O que é este pacote?
Este projeto Android usa **Trusted Web Activity (TWA)** para transformar
seu app web (${appUrl}) em um APK nativo para Android.
O app abre dentro do Chrome sem barra de endereço — igual a um app nativo.

---

## ✅ Requisitos para compilar

| Ferramenta | Onde baixar |
|---|---|
| Java JDK 17+ | https://adoptium.net |
| Android Studio | https://developer.android.com/studio |
| Gradle (já incluído via wrapper) | automático |

---

## 🚀 OPÇÃO 1 — Compilar com Android Studio (recomendado)

1. Abra o **Android Studio**
2. Clique em **File → Open** e selecione a pasta deste projeto
3. Aguarde o Gradle sincronizar (pode demorar alguns minutos na primeira vez)
4. Gere a keystore (assinatura):
   - Menu **Build → Generate Signed Bundle / APK**
   - Escolha **APK**
   - Clique em **Create new keystore...**
   - Preencha os dados e salve o arquivo .jks em local seguro
   - Escolha **release** e clique em **Finish**
5. O APK estará em: \`app/release/app-release.apk\`
6. Copie o APK para o celular e instale

---

## 🔧 OPÇÃO 2 — Compilar pela linha de comando

\`\`\`bash
# 1. Gerar keystore (faça só uma vez, guarde o arquivo)
keytool -genkey -v -keystore minha-chave.jks -keyalg RSA \\
  -keysize 2048 -validity 10000 -alias meu-app

# 2. Criar local.properties com o caminho do Android SDK
echo "sdk.dir=/home/SEU_USUARIO/Android/Sdk" > local.properties
# No Mac: /Users/SEU_USUARIO/Library/Android/sdk
# No Windows: C:\\Users\\SEU_USUARIO\\AppData\\Local\\Android\\Sdk

# 3. Compilar APK de release
./gradlew assembleRelease

# 4. Assinar o APK
jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \\
  -keystore minha-chave.jks \\
  app/build/outputs/apk/release/app-release-unsigned.apk \\
  meu-app

# 5. Otimizar (zipalign)
zipalign -v 4 \\
  app/build/outputs/apk/release/app-release-unsigned.apk \\
  app-release-final.apk
\`\`\`

---

## 📲 OPÇÃO 3 — PWABuilder.com (sem Android Studio)

1. Acesse: **https://pwabuilder.com**
2. Cole a URL: \`${appUrl}\`
3. Clique em **Start** e aguarde a análise
4. Na seção **Android**, clique em **Download**
5. Escolha **Android** e baixe o pacote
6. O arquivo \`.apk\` já vem assinado e pronto para instalar

---

## 📱 Instalar o APK no celular

1. Copie o arquivo \`.apk\` para o celular (via cabo USB, email ou Google Drive)
2. No Android: **Configurações → Segurança → Fontes desconhecidas** (ativar)
   - Em versões mais novas: ao tentar instalar, aparece a opção automaticamente
3. Toque no arquivo .apk no gerenciador de arquivos
4. Toque em **Instalar**

---

## ⚠️ Nota sobre Digital Asset Links

Para o TWA funcionar sem barra de URL, você precisa hospedar o arquivo
\`assetlinks.json\` em:

\`${appUrl}/.well-known/assetlinks.json\`

Use o conteúdo do arquivo \`.well-known/assetlinks.json\` incluído neste pacote,
substituindo o fingerprint SHA-256 pelo fingerprint da sua keystore:

\`\`\`bash
# Obter o fingerprint da sua keystore:
keytool -list -v -keystore minha-chave.jks -alias meu-app | grep SHA256
\`\`\`

Sem o assetlinks.json, o app funciona mas exibe uma barra de URL pequena.
`,

    "settings.gradle": `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "TwaApp"
include ':app'
`,

    "build.gradle": `buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.2.2'
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

task clean(type: Delete) {
    delete rootProject.buildDir
}
`,

    "app/build.gradle": `plugins {
    id 'com.android.application'
}

android {
    namespace '${packageName}'
    compileSdk 34

    defaultConfig {
        applicationId '${packageName}'
        minSdk 21
        targetSdk 34
        versionCode 1
        versionName "1.0"
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
    implementation 'com.google.androidbrowserhelper:androidbrowserhelper:2.5.0'
}
`,

    "app/src/main/AndroidManifest.xml": `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:allowBackup="true"
        android:theme="@style/Theme.AppCompat.NoActionBar">

        <activity
            android:name="com.google.androidbrowserhelper.trusted.LauncherActivity"
            android:exported="true">

            <meta-data
                android:name="android.support.customtabs.trusted.DEFAULT_URL"
                android:value="@string/default_url" />

            <meta-data
                android:name="android.support.customtabs.trusted.STATUS_BAR_COLOR"
                android:value="@color/colorPrimary"/>

            <meta-data
                android:name="android.support.customtabs.trusted.NAVIGATION_BAR_COLOR"
                android:value="@color/colorPrimary"/>

            <meta-data
                android:name="android.support.customtabs.trusted.SPLASH_IMAGE_DRAWABLE"
                android:value="@drawable/splash"/>

            <meta-data
                android:name="android.support.customtabs.trusted.SPLASH_SCREEN_BACKGROUND_COLOR"
                android:value="@color/backgroundColor"/>

            <meta-data
                android:name="android.support.customtabs.trusted.SPLASH_SCREEN_FADE_OUT_DURATION"
                android:value="300"/>

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="https" android:host="${host}"/>
            </intent-filter>

        </activity>

        <service
            android:name="com.google.androidbrowserhelper.trusted.DelegationService"
            android:exported="true"
            android:enabled="true">
            <intent-filter>
                <action android:name="android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE"/>
                <category android:name="android.intent.category.DEFAULT"/>
            </intent-filter>
        </service>

    </application>

</manifest>
`,

    "app/src/main/res/values/strings.xml": `<resources>
    <string name="app_name">SK Code Editor</string>
    <string name="default_url">${appUrl}</string>
</resources>
`,

    "app/src/main/res/values/colors.xml": `<resources>
    <color name="colorPrimary">#1a237e</color>
    <color name="colorPrimaryDark">#0d1117</color>
    <color name="colorAccent">#7ec87a</color>
    <color name="backgroundColor">#0d1117</color>
</resources>
`,

    "app/proguard-rules.pro": `# TWA ProGuard Rules
-keep class com.google.androidbrowserhelper.** { *; }
`,

    "gradle/wrapper/gradle-wrapper.properties": `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.4-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`,

    ".well-known/assetlinks.json": JSON.stringify([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: packageName,
          sha256_cert_fingerprints: [
            "SUBSTITUA_PELO_SHA256_DA_SUA_KEYSTORE"
          ],
        },
      },
    ], null, 2),

    "app/src/main/res/drawable/splash.xml": `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/backgroundColor"/>
</layer-list>
`,
  };

  res.json({ files, appUrl, host, packageName });
});

export default router;
