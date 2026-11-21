// The Android UI review's pixel comparison: native/scripts/android-ui-review.sh runs it in the
// Android image with `java AndroidUiReviewCompare.java <jobs.tsv> <composites-dir>` (JDK 17, one
// source file, no build). SPDX-License-Identifier: AGPL-3.0-only. See LICENSE.md.
//
// Reads the jobs ui-review-report.py writes (`story size base head head2`, `absent` for a side
// with no story) and prints one line per job in the format its `report` step reads:
//
//   story  size  status  diffPixels  totalPixels  diffPercent  composite|-  note
//
// status is new, removed, changed, unchanged or failed (exact pixels: Robolectric's renders are
// deterministic, so there is no fuzz and no second head render). A changed shot gets a
// composite, before | after | diff, with the diff the after shot dimmed and the differing pixels
// in red, as the desktop review draws it.

import java.awt.image.BufferedImage;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import javax.imageio.ImageIO;

public class AndroidUiReviewCompare {
    private static final int GAP = 16;

    public static void main(String[] args) throws IOException {
        if (args.length != 2) {
            System.err.println("usage: AndroidUiReviewCompare <jobs.tsv> <composites-dir>");
            System.exit(2);
        }
        File composites = new File(args[1]);
        composites.mkdirs();
        List<String> jobs = Files.readAllLines(Path.of(args[0]));
        for (String job : jobs) {
            if (job.isBlank()) continue;
            String[] f = job.split("\t");
            String story = f[0], size = f[1], base = f[2], head = f[3];
            System.out.println(String.join("\t", compare(story, size, base, head, composites)));
        }
    }

    private static String[] row(String story, String size, String status, long diff, long total, String composite, String note) {
        double percent = total == 0 ? 0 : 100.0 * diff / total;
        return new String[] {story, size, status, Long.toString(diff), Long.toString(total),
            String.format(java.util.Locale.ROOT, "%.4f", percent), composite, note};
    }

    private static BufferedImage read(String path) throws IOException {
        BufferedImage image = ImageIO.read(new File(path));
        if (image == null) throw new IOException("not an image: " + path);
        return image;
    }

    static String[] compare(String story, String size, String base, String head, File composites) {
        boolean hasBase = !base.equals("absent") && new File(base).isFile();
        boolean hasHead = !head.equals("absent") && new File(head).isFile();
        try {
            if (!head.equals("absent") && !hasHead) {
                return row(story, size, "failed", 0, 0, "-", "the head render is missing");
            }
            if (!base.equals("absent") && !hasBase) {
                return row(story, size, "failed", 0, 0, "-", "the base render is missing");
            }
            if (!hasBase && hasHead) {
                BufferedImage after = read(head);
                return row(story, size, "new", 0, (long) after.getWidth() * after.getHeight(), head, "");
            }
            if (hasBase && !hasHead) {
                BufferedImage before = read(base);
                return row(story, size, "removed", 0, (long) before.getWidth() * before.getHeight(), base, "");
            }
            if (!hasBase) return row(story, size, "failed", 0, 0, "-", "neither side rendered");
            BufferedImage before = read(base);
            BufferedImage after = read(head);
            int width = Math.max(before.getWidth(), after.getWidth());
            int height = Math.max(before.getHeight(), after.getHeight());
            long total = (long) width * height;
            BufferedImage diff = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
            long differing = 0;
            for (int y = 0; y < height; y++) {
                for (int x = 0; x < width; x++) {
                    int a = pixel(before, x, y);
                    int b = pixel(after, x, y);
                    if (a != b) {
                        differing++;
                        diff.setRGB(x, y, 0xFFFF0000);
                    } else {
                        diff.setRGB(x, y, dim(b));
                    }
                }
            }
            if (differing == 0) return row(story, size, "unchanged", 0, total, "-", "");
            File out = new File(composites, story + "-" + size + ".png");
            BufferedImage composite = new BufferedImage(width * 3 + GAP * 2, height, BufferedImage.TYPE_INT_ARGB);
            var g = composite.createGraphics();
            g.setColor(java.awt.Color.WHITE);
            g.fillRect(0, 0, composite.getWidth(), height);
            g.drawImage(before, 0, 0, null);
            g.drawImage(after, width + GAP, 0, null);
            g.drawImage(diff, (width + GAP) * 2, 0, null);
            g.dispose();
            ImageIO.write(composite, "png", out);
            return row(story, size, "changed", differing, total, out.getPath(), "");
        } catch (IOException e) {
            return row(story, size, "failed", 0, 0, "-", e.getMessage().replace('\t', ' '));
        }
    }

    /** A pixel, or transparent outside the image (the two sides may differ in size). */
    private static int pixel(BufferedImage image, int x, int y) {
        return x < image.getWidth() && y < image.getHeight() ? image.getRGB(x, y) : 0;
    }

    /** The after pixel at a third of its brightness, so the red differences stand out. */
    private static int dim(int argb) {
        int r = ((argb >> 16) & 0xFF) / 3, g = ((argb >> 8) & 0xFF) / 3, b = (argb & 0xFF) / 3;
        return 0xFF000000 | (r << 16) | (g << 8) | b;
    }
}
