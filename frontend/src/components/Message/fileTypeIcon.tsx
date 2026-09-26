import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import DescriptionIcon from "@mui/icons-material/Description";
import CodeIcon from "@mui/icons-material/Code";
import ArchiveIcon from "@mui/icons-material/Archive";

/** Icon for a non-media file by MIME type (PDF, text, archive, code, other). */
export function getFileIcon(mimeType: string, fontSize: "small" | "medium" | "large" = "large") {
  if (mimeType.includes("pdf")) {
    return <PictureAsPdfIcon fontSize={fontSize} />;
  } else if (mimeType.includes("text") || mimeType.includes("document")) {
    return <DescriptionIcon fontSize={fontSize} />;
  } else if (mimeType.includes("zip") || mimeType.includes("archive") || mimeType.includes("compressed")) {
    return <ArchiveIcon fontSize={fontSize} />;
  } else if (mimeType.includes("code") || mimeType.includes("javascript") || mimeType.includes("json") || mimeType.includes("xml")) {
    return <CodeIcon fontSize={fontSize} />;
  }
  return <InsertDriveFileIcon fontSize={fontSize} />;
}
