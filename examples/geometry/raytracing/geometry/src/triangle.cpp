#include <raytracing/geometry/include/triangle.h>

Triangle::Triangle() = default;

Triangle::Triangle(const Vector& a, const Vector& b, const Vector& c) : vertices_{a, b, c} {
}

double Triangle::Area() const {
    return Length(CrossProduct(vertices_[1] - vertices_[0], vertices_[2] - vertices_[0])) / 2;
}

const Vector& Triangle::operator[](size_t ind) const {
    return vertices_[ind];
}
