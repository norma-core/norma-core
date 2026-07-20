//! Minimal hand-rolled vector/rotation math for the 7-joint ElRobot arm chain.
//!
//! No `nalgebra`/`urdf-rs` dependency is added here: the chain is small and
//! fixed, and the codebase already hand-rolls similarly small numeric
//! helpers elsewhere (see `st3215::protocol::units`).

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3 {
    pub const ZERO: Vec3 = Vec3 { x: 0.0, y: 0.0, z: 0.0 };

    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn add(self, other: Vec3) -> Vec3 {
        Vec3::new(self.x + other.x, self.y + other.y, self.z + other.z)
    }

    pub fn sub(self, other: Vec3) -> Vec3 {
        Vec3::new(self.x - other.x, self.y - other.y, self.z - other.z)
    }

    pub fn scale(self, s: f64) -> Vec3 {
        Vec3::new(self.x * s, self.y * s, self.z * s)
    }

    pub fn dot(self, other: Vec3) -> f64 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    pub fn cross(self, other: Vec3) -> Vec3 {
        Vec3::new(
            self.y * other.z - self.z * other.y,
            self.z * other.x - self.x * other.z,
            self.x * other.y - self.y * other.x,
        )
    }

    pub fn norm(self) -> f64 {
        self.dot(self).sqrt()
    }

    pub fn normalize(self) -> Vec3 {
        let n = self.norm();
        if n < 1e-12 {
            return Vec3::ZERO;
        }
        self.scale(1.0 / n)
    }
}

/// Row-major 3x3 rotation matrix.
#[derive(Clone, Copy, Debug)]
pub struct Mat3 {
    pub rows: [Vec3; 3],
}

impl Mat3 {
    pub const IDENTITY: Mat3 = Mat3 {
        rows: [
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
            Vec3::new(0.0, 0.0, 1.0),
        ],
    };

    pub fn mul_vec3(&self, v: Vec3) -> Vec3 {
        Vec3::new(self.rows[0].dot(v), self.rows[1].dot(v), self.rows[2].dot(v))
    }

    /// `self * other` (applies `other` first, then `self`).
    pub fn mul_mat3(&self, other: &Mat3) -> Mat3 {
        let cols = [
            Vec3::new(other.rows[0].x, other.rows[1].x, other.rows[2].x),
            Vec3::new(other.rows[0].y, other.rows[1].y, other.rows[2].y),
            Vec3::new(other.rows[0].z, other.rows[1].z, other.rows[2].z),
        ];
        Mat3 {
            rows: [
                Vec3::new(self.rows[0].dot(cols[0]), self.rows[0].dot(cols[1]), self.rows[0].dot(cols[2])),
                Vec3::new(self.rows[1].dot(cols[0]), self.rows[1].dot(cols[1]), self.rows[1].dot(cols[2])),
                Vec3::new(self.rows[2].dot(cols[0]), self.rows[2].dot(cols[1]), self.rows[2].dot(cols[2])),
            ],
        }
    }

    /// Rotation matrix for a rotation of `angle_rad` about `axis` (Rodrigues' formula).
    /// `axis` need not be pre-normalized.
    pub fn from_axis_angle(axis: Vec3, angle_rad: f64) -> Mat3 {
        let axis = axis.normalize();
        let (sin, cos) = angle_rad.sin_cos();
        let one_minus_cos = 1.0 - cos;

        let (x, y, z) = (axis.x, axis.y, axis.z);

        Mat3 {
            rows: [
                Vec3::new(
                    cos + x * x * one_minus_cos,
                    x * y * one_minus_cos - z * sin,
                    x * z * one_minus_cos + y * sin,
                ),
                Vec3::new(
                    y * x * one_minus_cos + z * sin,
                    cos + y * y * one_minus_cos,
                    y * z * one_minus_cos - x * sin,
                ),
                Vec3::new(
                    z * x * one_minus_cos - y * sin,
                    z * y * one_minus_cos + x * sin,
                    cos + z * z * one_minus_cos,
                ),
            ],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_rotation_is_noop() {
        let v = Vec3::new(1.0, 2.0, 3.0);
        assert_eq!(Mat3::IDENTITY.mul_vec3(v), v);
    }

    #[test]
    fn rotate_90_degrees_about_z() {
        let r = Mat3::from_axis_angle(Vec3::new(0.0, 0.0, 1.0), std::f64::consts::FRAC_PI_2);
        let v = r.mul_vec3(Vec3::new(1.0, 0.0, 0.0));
        assert!((v.x).abs() < 1e-9);
        assert!((v.y - 1.0).abs() < 1e-9);
        assert!((v.z).abs() < 1e-9);
    }

    #[test]
    fn cross_product_orthogonal() {
        let x = Vec3::new(1.0, 0.0, 0.0);
        let y = Vec3::new(0.0, 1.0, 0.0);
        let z = x.cross(y);
        assert!((z.x).abs() < 1e-9);
        assert!((z.y).abs() < 1e-9);
        assert!((z.z - 1.0).abs() < 1e-9);
    }
}
