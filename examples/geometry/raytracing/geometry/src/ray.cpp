#include <raytracing/geometry/include/ray.h>

Ray::Ray(const Vector& origin, const Vector& direction) : origin_(origin), direction_(direction) {
    direction_.Normalize();
}

const Vector& Ray::GetOrigin() const {
    return origin_;
}

const Vector& Ray::GetDirection() const {
    return direction_;
}
