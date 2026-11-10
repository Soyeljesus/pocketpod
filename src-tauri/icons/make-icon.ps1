Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

# Carcasa exterior
$body = New-RoundedPath 92 60 840 904 190
$bodyBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(92, 60)),
    (New-Object System.Drawing.Point(932, 964)),
    [System.Drawing.Color]::FromArgb(255, 250, 251, 252),
    [System.Drawing.Color]::FromArgb(255, 196, 199, 206))
$g.FillPath($bodyBrush, $body)
$outlinePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 0, 0, 0), 6)
$g.DrawPath($outlinePen, $body)

# Pantalla
$screen = New-RoundedPath 168 138 688 404 34
$screenBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(168, 138)),
    (New-Object System.Drawing.Point(856, 542)),
    [System.Drawing.Color]::FromArgb(255, 30, 34, 42),
    [System.Drawing.Color]::FromArgb(255, 10, 12, 16))
$g.FillPath($screenBrush, $screen)
$screenPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 20, 20, 22), 10)
$g.DrawPath($screenPen, $screen)

# Contenido de la pantalla: título, subtítulo, portada y barra de progreso
$white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 255, 255, 255))
$dim = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 255, 255, 255))
$g.FillRectangle($white, 210, 185, 300, 22)
$g.FillRectangle($dim, 210, 220, 210, 14)

$artBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(210, 270)),
    (New-Object System.Drawing.Point(410, 470)),
    [System.Drawing.Color]::FromArgb(255, 90, 158, 232),
    [System.Drawing.Color]::FromArgb(255, 47, 111, 187))
$g.FillRectangle($artBrush, 210, 270, 200, 200)

$barBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 70, 74, 82))
$barFill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 77, 179, 230))
$g.FillRectangle($barBg, 210, 500, 600, 16)
$g.FillRectangle($barFill, 210, 500, 250, 16)

# Rueda click
$wheelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 236, 238, 242))
$g.FillEllipse($wheelBrush, 342, 600, 340, 340)
$g.DrawEllipse($outlinePen, 342, 600, 340, 340)
$centerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 250, 251, 252))
$g.FillEllipse($centerBrush, 450, 738, 124, 124)
$g.DrawEllipse($outlinePen, 450, 738, 124, 124)

$target = Join-Path $PSScriptRoot "app-icon.png"
$bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
Write-Output "Icono generado en $target"
