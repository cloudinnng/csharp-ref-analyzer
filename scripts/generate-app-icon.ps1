#Requires -Version 5.1
# 重新生成 wwwroot/favicon*.png、favicon.ico 与根目录 app.ico
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\generate-app-icon.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

function New-AppIconBitmap([int]$Size) {
    $Bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $G = [System.Drawing.Graphics]::FromImage($Bmp)
    $G.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $G.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $G.Clear([System.Drawing.Color]::Transparent)
    $S = $Size / 32.0
    function SX([double]$V) { return [float]($V * $S) }
    $Bg1 = [System.Drawing.Color]::FromArgb(255,0x1a,0x23,0x32)
    $Bg2 = [System.Drawing.Color]::FromArgb(255,0x0f,0x14,0x19)
    $Border = [System.Drawing.Color]::FromArgb(255,0x2d,0x3a,0x4f)
    $Class = [System.Drawing.Color]::FromArgb(255,0x79,0xc0,0xff)
    $Iface = [System.Drawing.Color]::FromArgb(255,0xd2,0xa8,0xff)
    $Struct = [System.Drawing.Color]::FromArgb(255,0x7e,0xe7,0x87)
    $Edge1 = [System.Drawing.Color]::FromArgb(255,0x58,0xa6,0xff)
    $Edge2 = [System.Drawing.Color]::FromArgb(255,0x8b,0x9c,0xb3)
    $Path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $R = [Math]::Max(2.0, 7.0 * $S)
    $Rect = New-Object System.Drawing.RectangleF (SX 1),(SX 1),(SX 30),(SX 30)
    $D = $R * 2
    $Path.AddArc($Rect.X,$Rect.Y,$D,$D,180,90)
    $Path.AddArc($Rect.Right-$D,$Rect.Y,$D,$D,270,90)
    $Path.AddArc($Rect.Right-$D,$Rect.Bottom-$D,$D,$D,0,90)
    $Path.AddArc($Rect.X,$Rect.Bottom-$D,$D,$D,90,90)
    $Path.CloseFigure()
    $Brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF (SX 1),(SX 1)),(New-Object System.Drawing.PointF (SX 31),(SX 31)),$Bg1,$Bg2
    $G.FillPath($Brush,$Path)
    $PenBorder = New-Object System.Drawing.Pen $Border,([Math]::Max(1.0,1.0*$S))
    $G.DrawPath($PenBorder,$Path)
    if ($Size -le 16) {
        $G.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
        $G.FillRectangle((New-Object System.Drawing.SolidBrush $Class),3,3,5,5)
        $G.FillEllipse((New-Object System.Drawing.SolidBrush $Iface),9,3,5,5)
        $G.FillPolygon((New-Object System.Drawing.SolidBrush $Struct),@((New-Object System.Drawing.Point 4,13),(New-Object System.Drawing.Point 8,9),(New-Object System.Drawing.Point 12,13)))
        $PenE = New-Object System.Drawing.Pen $Edge1,1; $G.DrawLine($PenE,8,5,9,5); $PenE.Dispose()
        $PenE2 = New-Object System.Drawing.Pen $Edge2,1; $G.DrawLine($PenE2,5,8,5,10); $PenE2.Dispose()
    } else {
        $Pen1 = New-Object System.Drawing.Pen $Edge1,([Math]::Max(1.2,1.6*$S))
        $G.DrawLine($Pen1,(SX 11),(SX 12.5),(SX 20),(SX 12.5))
        $G.FillPolygon((New-Object System.Drawing.SolidBrush $Edge1),@((New-Object System.Drawing.PointF (SX 17.5),(SX 10.5)),(New-Object System.Drawing.PointF (SX 20.5),(SX 12.5)),(New-Object System.Drawing.PointF (SX 17.5),(SX 14.5))))
        $Pen2 = New-Object System.Drawing.Pen $Edge2,([Math]::Max(1.0,1.4*$S))
        $G.DrawLines($Pen2,@((New-Object System.Drawing.PointF (SX 12),(SX 14.5)),(New-Object System.Drawing.PointF (SX 12),(SX 21.5)),(New-Object System.Drawing.PointF (SX 19),(SX 21.5))))
        $G.FillPolygon((New-Object System.Drawing.SolidBrush $Edge2),@((New-Object System.Drawing.PointF (SX 17),(SX 19.5)),(New-Object System.Drawing.PointF (SX 19.5),(SX 21.5)),(New-Object System.Drawing.PointF (SX 17),(SX 23.5))))
        $NodePath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $Nr=[Math]::Max(1.0,1.5*$S); $NrD=$Nr*2; $Nx=SX 6; $Ny=SX 9; $Nw=SX 7; $Nh=SX 7
        $NodePath.AddArc($Nx,$Ny,$NrD,$NrD,180,90); $NodePath.AddArc($Nx+$Nw-$NrD,$Ny,$NrD,$NrD,270,90); $NodePath.AddArc($Nx+$Nw-$NrD,$Ny+$Nh-$NrD,$NrD,$NrD,0,90); $NodePath.AddArc($Nx,$Ny+$Nh-$NrD,$NrD,$NrD,90,90); $NodePath.CloseFigure()
        $G.FillPath((New-Object System.Drawing.SolidBrush $Class),$NodePath); $NodePath.Dispose()
        $G.FillEllipse((New-Object System.Drawing.SolidBrush $Iface),(SX 19.9),(SX 8.9),(SX 7.2),(SX 7.2))
        $G.FillPolygon((New-Object System.Drawing.SolidBrush $Struct),@((New-Object System.Drawing.PointF (SX 19.2),(SX 24.8)),(New-Object System.Drawing.PointF (SX 23.5),(SX 18.8)),(New-Object System.Drawing.PointF (SX 27.8),(SX 24.8))))
        $Pen1.Dispose(); $Pen2.Dispose()
    }
    $Brush.Dispose(); $PenBorder.Dispose(); $Path.Dispose(); $G.Dispose(); return $Bmp
}

function New-IconFileFromPngBytes([string]$IcoPath,[byte[][]]$PngChunks,[int[]]$Sizes) {
    $Count=$PngChunks.Length; $Stream=New-Object System.IO.MemoryStream; $Bw=New-Object System.IO.BinaryWriter $Stream
    $Bw.Write([uint16]0); $Bw.Write([uint16]1); $Bw.Write([uint16]$Count)
    $Offset=6+(16*$Count); $Offsets=New-Object int[] $Count
    for($i=0;$i -lt $Count;$i++){ $Offsets[$i]=$Offset; $Offset += $PngChunks[$i].Length }
    for($i=0;$i -lt $Count;$i++){ $Sz=$Sizes[$i]; $W=if($Sz -ge 256){[byte]0}else{[byte]$Sz}; $Bw.Write([byte]$W); $Bw.Write([byte]$W); $Bw.Write([byte]0); $Bw.Write([byte]0); $Bw.Write([uint16]1); $Bw.Write([uint16]32); $Bw.Write([uint32]$PngChunks[$i].Length); $Bw.Write([uint32]$Offsets[$i]) }
    for($i=0;$i -lt $Count;$i++){ $Bw.Write($PngChunks[$i]) }
    $Bw.Flush(); [System.IO.File]::WriteAllBytes($IcoPath,$Stream.ToArray()); $Bw.Dispose(); $Stream.Dispose()
}

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Www = Join-Path $Root "wwwroot"
$Sizes = @(16,32,48,256); $PngChunks=@(); $PngSizes=@()
foreach($Size in $Sizes){
    $Bmp = New-AppIconBitmap $Size
    $PngPath = Join-Path $Www ("favicon-{0}.png" -f $Size)
    $Bmp.Save($PngPath,[System.Drawing.Imaging.ImageFormat]::Png)
    $Ms=New-Object System.IO.MemoryStream; $Bmp.Save($Ms,[System.Drawing.Imaging.ImageFormat]::Png)
    $PngChunks += , $Ms.ToArray(); $PngSizes += $Size; $Ms.Dispose(); $Bmp.Dispose()
    Write-Host "[generate-app-icon] $PngPath"
}
$IcoPath = Join-Path $Www "favicon.ico"
New-IconFileFromPngBytes $IcoPath $PngChunks $PngSizes
Copy-Item $IcoPath (Join-Path $Root "app.ico") -Force
Write-Host "[generate-app-icon] $IcoPath"
Write-Host "[generate-app-icon] $(Join-Path $Root 'app.ico')"