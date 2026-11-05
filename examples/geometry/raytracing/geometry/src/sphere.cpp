#include <raytracing/geometry/include/sphere.h>

Sphere::Sphere(const Vector& center, double radius) : center_(center), radius_(radius) {
}

const Vector& Sphere::GetCenter() const {
    return center_;
}

double Sphere::GetRadius() const {
    return radius_;
}
