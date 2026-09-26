<#
    Comprobar el correo de un dominio: qué envía, qué recibe y si sigue sano.

    Se lanza desde PowerShell, que es el shell de esta casa:

        powershell -ExecutionPolicy Bypass -File docs\comprobar-correo.ps1
        powershell -ExecutionPolicy Bypass -File docs\comprobar-correo.ps1 -Dominio veltorent.com

    ⚠️ **Existe porque el procedimiento de publicar toca el DNS del dominio desde
    el que se mandan los contratos firmados a los clientes.** Lo que hay que
    proteger son tres registros —el SPF y el MX de `send.`, y el DKIM de
    Resend—, y la forma de saber que siguen ahí es mirarlos antes y después.

    ⚠️ **Y no es código de la aplicación**: no se compila, no se importa y no
    entra en ningún build. Vive en `docs/` por lo mismo que
    `comprobar-reglas-facturas.js`, para que no lo parezca.

    ⚠️ **PowerShell, no Bash.** La primera versión del procedimiento traía
    `nslookup … | grep`, que en PowerShell falla con «grep : no se reconoce el
    término». Es el mismo despiste que CLAUDE.md ya tenía anotado para
    `FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy`: el prefijo `VAR=valor` y
    las tuberías a `grep` son de shell tipo Unix, y aquí no existen.
    `Resolve-DnsName` es nativo y además devuelve objetos, así que no hace falta
    recortar texto con expresiones regulares.
#>

param(
    [string]$Dominio = 'veltomobility.com',
    # Un resolutor público y explícito: preguntar al del router devuelve lo que
    # él tenga cacheado, que después de tocar el DNS es justo lo que no sirve.
    [string]$Servidor = '8.8.8.8'
)

function Registro {
    param([string]$Nombre, [string]$Tipo)
    $r = Resolve-DnsName $Nombre -Type $Tipo -Server $Servidor -ErrorAction SilentlyContinue
    if (-not $r) { return @() }
    return @($r | Where-Object Type -eq $Tipo)
}

function Titulo { param([string]$T) Write-Host ''; Write-Host "-- $T" -ForegroundColor Cyan }

Write-Host ''
Write-Host "  CORREO DE $Dominio" -ForegroundColor White
Write-Host "  (resolutor $Servidor | $(Get-Date -Format 'yyyy-MM-dd HH:mm'))" -ForegroundColor DarkGray

# ---------------------------------------------------------------------------
# 1. ENVIAR — los tres registros de Resend. Son los que NO pueden cambiar.
# ---------------------------------------------------------------------------
Titulo 'ENVIAR (Resend) — esto es lo que hay que proteger'

$spfSend  = Registro "send.$Dominio" 'TXT'
$mxSend   = Registro "send.$Dominio" 'MX'
$dkim     = Registro "resend._domainkey.$Dominio" 'TXT'

$envioOk = $true

if ($spfSend) { Write-Host "  SPF de send.  : $($spfSend.Strings -join '')" }
else          { Write-Host "  SPF de send.  : FALTA" -ForegroundColor Red; $envioOk = $false }

if ($mxSend)  { Write-Host "  MX de send.   : $($mxSend[0].Preference) $($mxSend[0].NameExchange)" }
else          { Write-Host "  MX de send.   : FALTA" -ForegroundColor Red; $envioOk = $false }

if ($dkim)    {
    $clave = ($dkim.Strings -join '')
    Write-Host "  DKIM de Resend: $($clave.Substring(0, [Math]::Min(48, $clave.Length)))...  ($($clave.Length) caracteres)"
} else        { Write-Host "  DKIM de Resend: FALTA" -ForegroundColor Red; $envioOk = $false }

if ($envioOk) { Write-Host '  -> el envio esta SANO' -ForegroundColor Green }
else {
    Write-Host '  -> EL ENVIO ESTA ROTO: faltan registros de Resend.' -ForegroundColor Red
    Write-Host '    Los valores buenos estan en Resend -> Domains -> Records.' -ForegroundColor Red
    Write-Host '    Mientras tanto, cambiar VELTO_COMPANY_EMAIL al otro dominio.' -ForegroundColor Red
}

# ---------------------------------------------------------------------------
# 2. RECIBIR — Cloudflare Email Routing.
# ---------------------------------------------------------------------------
Titulo 'RECIBIR (Cloudflare Email Routing)'

$mxApex = Registro $Dominio 'MX'
if ($mxApex) {
    $mxApex | Sort-Object Preference | ForEach-Object {
        Write-Host "  MX: $($_.Preference)  $($_.NameExchange)"
    }
    if ($mxApex.NameExchange -match 'mx\.cloudflare\.net') {
        Write-Host '  -> RECIBE: Email Routing activo' -ForegroundColor Green
    } else {
        Write-Host '  -> recibe, pero NO por Cloudflare' -ForegroundColor Yellow
    }
} else {
    Write-Host '  MX: ninguno' -ForegroundColor Yellow
    Write-Host '  -> NO RECIBE. Lo que se mande aqui se pierde.' -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 3. EL APEX — donde vive el riesgo de pisarse.
# ---------------------------------------------------------------------------
Titulo 'SPF del apex — que no se mezcle con el de Resend'

$txtApex = Registro $Dominio 'TXT'
$spfApex = @($txtApex | Where-Object { ($_.Strings -join '') -like 'v=spf1*' })

if ($spfApex.Count -eq 0) {
    Write-Host '  (ninguno)'
    Write-Host '  -> correcto mientras no haya Email Routing' -ForegroundColor DarkGray
} elseif ($spfApex.Count -gt 1) {
    # Dos v=spf1 en el mismo nombre dan PermError, y SPF deja de valer para
    # nada. No lo avisa ninguna pantalla: el sintoma es que el correo empieza a
    # caer en spam.
    Write-Host "  HAY $($spfApex.Count) REGISTROS v=spf1 EN EL APEX" -ForegroundColor Red
    $spfApex | ForEach-Object { Write-Host "    $($_.Strings -join '')" -ForegroundColor Red }
    Write-Host '  -> PermError: SPF deja de valer. Dejar UNO solo.' -ForegroundColor Red
} else {
    $v = ($spfApex.Strings -join '')
    Write-Host "  $v"
    if ($v -like '*amazonses*') {
        # El apex es de Cloudflare y `send.` es de Resend. Alguien que mire el
        # panel de Resend puede sentirse tentado de anadir su include aqui.
        Write-Host '  -> OJO: el apex lleva el include de Resend.' -ForegroundColor Red
        Write-Host '    Ese va en send., no aqui. El apex es de Cloudflare.' -ForegroundColor Red
    } else {
        Write-Host '  -> correcto: el apex no toca lo de Resend' -ForegroundColor Green
    }
}

# ---------------------------------------------------------------------------
# 4. DMARC
# ---------------------------------------------------------------------------
Titulo 'DMARC'
$dmarc = Registro "_dmarc.$Dominio" 'TXT'
if ($dmarc) {
    $d = ($dmarc.Strings -join '')
    Write-Host "  $d"
    if ($d -match 'p\s*=\s*(reject|quarantine)') {
        # El reenvio rompe SPF por diseno: Cloudflare reescribe el sobre. Con
        # una politica dura, correo legitimo de clientes deja de entrar y el
        # Activity log de Cloudflare dice que lo entrego.
        Write-Host '  -> CUIDADO con el reenvio: politica dura + forwarding' -ForegroundColor Yellow
    }
} else {
    Write-Host '  (ninguno) -> hoy no estorba; si algun dia se pone, empezar por p=none' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  Esto mide el DNS. Que el correo LLEGUE BIEN solo lo dice la' -ForegroundColor DarkGray
Write-Host '  cabecera de un correo real: Gmail -> Mostrar original ->' -ForegroundColor DarkGray
Write-Host '  spf=pass (citando send.) y dkim=pass header.d=' -NoNewline -ForegroundColor DarkGray
Write-Host $Dominio -ForegroundColor DarkGray
Write-Host ''
