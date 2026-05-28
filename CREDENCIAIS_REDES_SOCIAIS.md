# Credenciais das redes sociais

Preenche as credenciais reais no ficheiro `.env.local`. Depois de alterar este ficheiro, reinicia o servidor Next.js.

## URL base da aplicacao

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Usa o URL real se estiveres a correr a app noutro endereco, por exemplo `https://teu-dominio.pt`.

## Facebook

```env
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
FACEBOOK_PAGE_ID=
FACEBOOK_DIRECT_PUBLISH=false
```

No painel da Meta/Facebook, adiciona este redirect URI:

```text
np
```

Se quiseres publicar diretamente na pagina do Facebook a partir da app, define:

```env
FACEBOOK_DIRECT_PUBLISH=true
```

Se deixares `FACEBOOK_PAGE_ID` vazio, a app usa a primeira pagina devolvida pela Meta.

## Instagram

O Instagram Business e ligado pela mesma app da Meta/Facebook, por isso usa:

```env
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
```

No painel da Meta/Facebook, adiciona tambem este redirect URI:

```text
{NEXT_PUBLIC_APP_URL}/api/social/callback/instagram
```

## LinkedIn

```env
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
```

No painel do LinkedIn, adiciona este redirect URI:

```text
{NEXT_PUBLIC_APP_URL}/api/social/callback/linkedin
```

## Ficheiro de contas ligadas

```env
SOCIAL_ACCOUNTS_FILE=.data/social-accounts.json
```

Este ficheiro guarda tokens OAuth das contas ligadas. Deve ficar fora do Git.
